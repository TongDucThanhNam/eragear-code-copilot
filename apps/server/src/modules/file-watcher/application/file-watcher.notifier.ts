import type { EventBusPort } from "@/shared/ports/event-bus.port";

export interface FileWatcherChangedSession {
  userId: string;
  chatId: string;
  projectId?: string;
}

export interface FileWatcherFileChangedNotification {
  projectRoot: string;
  path: string;
  eventKind: "changed" | "renamed";
  sessions: FileWatcherChangedSession[];
}

export interface FileWatcherNotifier {
  fileChanged(input: FileWatcherFileChangedNotification): Promise<void>;
}

export interface EventBusFileWatcherNotifierOptions {
  now?: () => Date;
}

export function createEventBusFileWatcherNotifier(
  eventBus: EventBusPort,
  options: EventBusFileWatcherNotifierOptions = {}
): FileWatcherNotifier {
  const now = options.now ?? (() => new Date());
  return {
    async fileChanged(input) {
      await eventBus.publish({
        type: "file_watcher_file_changed",
        projectRoot: input.projectRoot,
        path: input.path,
        eventKind: input.eventKind,
        occurredAt: now().toISOString(),
        sessions: input.sessions,
      });
    },
  };
}

export const noopFileWatcherNotifier: FileWatcherNotifier = {
  fileChanged: () => Promise.resolve(),
};
