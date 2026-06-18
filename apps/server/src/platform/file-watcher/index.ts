import { type FSWatcher, watch } from "node:fs";
import path from "node:path";
import type {
  FileWatcherNotifier,
  FileWatcherPort,
  FileWatcherSessionInput,
  FileWatcherSnapshot,
  FileWatcherStatusInput,
  UnwatchSessionInput,
} from "@/modules/file-watcher";
import type { LoggerPort } from "@/shared/ports/logger.port";

const FILE_WATCHER_DEBOUNCE_MS = 150;
const IGNORED_TOP_LEVEL_PATHS = new Set([".git", "node_modules"]);
const BACKSLASH_PATTERN = /\\/g;
const LEADING_DOT_SLASH_PATTERN = /^\.\/+/;

interface WatchedSession {
  userId: string;
  chatId: string;
  projectId?: string;
}

interface WatchedRoot {
  projectRoot: string;
  sessions: Map<string, WatchedSession>;
  pendingChanges: Map<string, ReturnType<typeof setTimeout>>;
  watcher: FSWatcher | undefined;
  error: string | undefined;
}

export class FsFileWatcherAdapter implements FileWatcherPort {
  private readonly notifier: FileWatcherNotifier;
  private readonly logger: LoggerPort;
  private readonly roots = new Map<string, WatchedRoot>();
  private readonly chatRoots = new Map<string, string>();

  constructor(params: { notifier: FileWatcherNotifier; logger: LoggerPort }) {
    this.notifier = params.notifier;
    this.logger = params.logger;
  }

  watchSession(input: FileWatcherSessionInput): Promise<FileWatcherSnapshot> {
    const projectRoot = path.resolve(input.projectRoot);
    const existingRoot = this.chatRoots.get(input.chatId);
    if (existingRoot && existingRoot !== projectRoot) {
      this.removeSession(input.chatId);
    }

    const root = this.getOrCreateRoot(projectRoot);
    root.sessions.set(input.chatId, toWatchedSession(input));
    this.chatRoots.set(input.chatId, projectRoot);
    this.ensureWatcher(root);
    return Promise.resolve(this.getStatus());
  }

  unwatchSession(input: UnwatchSessionInput): Promise<FileWatcherSnapshot> {
    this.removeSession(input.chatId);
    return Promise.resolve(this.getStatus());
  }

  getStatus(input?: FileWatcherStatusInput): FileWatcherSnapshot {
    const roots = [...this.roots.values()]
      .map((root) => {
        const sessions = [...root.sessions.values()].filter(
          (session) => !input?.userId || session.userId === input.userId
        );
        return {
          projectRoot: root.projectRoot,
          watched: Boolean(root.watcher),
          chatIds: sessions.map((session) => session.chatId).sort(),
          ...(root.error ? { error: root.error } : {}),
        };
      })
      .filter((root) => root.chatIds.length > 0)
      .sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));

    return {
      roots,
      sessionCount: roots.reduce(
        (total, root) => total + root.chatIds.length,
        0
      ),
    };
  }

  dispose(): void {
    for (const root of this.roots.values()) {
      this.closeRoot(root);
    }
    this.roots.clear();
    this.chatRoots.clear();
  }

  private getOrCreateRoot(projectRoot: string): WatchedRoot {
    const existing = this.roots.get(projectRoot);
    if (existing) {
      return existing;
    }
    const root: WatchedRoot = {
      projectRoot,
      sessions: new Map(),
      pendingChanges: new Map(),
      watcher: undefined,
      error: undefined,
    };
    this.roots.set(projectRoot, root);
    return root;
  }

  private ensureWatcher(root: WatchedRoot): void {
    if (root.watcher) {
      return;
    }
    try {
      root.watcher = watch(
        root.projectRoot,
        { recursive: true },
        (eventType, filename) => {
          this.handleFsEvent(root, eventType, filename);
        }
      );
      root.watcher.on("error", (error) => {
        root.error = error instanceof Error ? error.message : String(error);
        this.logger.warn("File watcher error", {
          projectRoot: root.projectRoot,
          error: root.error,
        });
      });
      root.error = undefined;
    } catch (error) {
      root.error = error instanceof Error ? error.message : String(error);
      this.logger.warn("Failed to start file watcher", {
        projectRoot: root.projectRoot,
        error: root.error,
      });
    }
  }

  private handleFsEvent(
    root: WatchedRoot,
    eventType: "rename" | "change",
    filename: string | Buffer | null
  ): void {
    const relativePath = normalizeWatchFilename(filename);
    if (!relativePath || shouldIgnorePath(relativePath)) {
      return;
    }
    const existingTimer = root.pendingChanges.get(relativePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      root.pendingChanges.delete(relativePath);
      this.notifyChange(root, relativePath, eventType).catch((error) => {
        this.logger.warn("Unhandled file watcher notification failure", {
          projectRoot: root.projectRoot,
          path: relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, FILE_WATCHER_DEBOUNCE_MS);
    timer.unref?.();
    root.pendingChanges.set(relativePath, timer);
  }

  private async notifyChange(
    root: WatchedRoot,
    relativePath: string,
    eventType: "rename" | "change"
  ): Promise<void> {
    const sessions = [...root.sessions.values()];
    if (sessions.length === 0) {
      return;
    }
    try {
      await this.notifier.fileChanged({
        projectRoot: root.projectRoot,
        path: relativePath,
        eventKind: eventType === "rename" ? "renamed" : "changed",
        sessions,
      });
    } catch (error) {
      this.logger.warn("Failed to notify file watcher change", {
        projectRoot: root.projectRoot,
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private removeSession(chatId: string): void {
    const projectRoot = this.chatRoots.get(chatId);
    if (!projectRoot) {
      return;
    }
    this.chatRoots.delete(chatId);
    const root = this.roots.get(projectRoot);
    if (!root) {
      return;
    }
    root.sessions.delete(chatId);
    if (root.sessions.size === 0) {
      this.closeRoot(root);
      this.roots.delete(projectRoot);
    }
  }

  private closeRoot(root: WatchedRoot): void {
    for (const timer of root.pendingChanges.values()) {
      clearTimeout(timer);
    }
    root.pendingChanges.clear();
    root.watcher?.close();
    root.watcher = undefined;
  }
}

function toWatchedSession(input: FileWatcherSessionInput): WatchedSession {
  return {
    userId: input.userId,
    chatId: input.chatId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };
}

function normalizeWatchFilename(
  filename: string | Buffer | null
): string | null {
  if (!filename) {
    return null;
  }
  const raw = Buffer.isBuffer(filename) ? filename.toString("utf8") : filename;
  const normalized = raw
    .replace(BACKSLASH_PATTERN, "/")
    .replace(LEADING_DOT_SLASH_PATTERN, "");
  return normalized && normalized !== "." ? normalized : null;
}

function shouldIgnorePath(relativePath: string): boolean {
  const [topLevel] = relativePath.split("/");
  return Boolean(topLevel && IGNORED_TOP_LEVEL_PATHS.has(topLevel));
}
