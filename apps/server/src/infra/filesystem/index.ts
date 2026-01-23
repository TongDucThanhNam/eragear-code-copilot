// FileSystem adapter for ACP
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FileSystemPort,
  SessionRuntimePort,
} from "../../shared/types/ports";
import type { ChatSession } from "../../shared/types/session.types";

const LINE_SPLITTER_REGEX = /\r?\n/;

function fileUriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.replace("file://", ""));
  }
  return uri;
}

async function resolvePathInSessionImpl(
  session: ChatSession,
  inputPath: string
): Promise<string> {
  const rawPath = fileUriToPath(inputPath);
  const baseRoot = path.resolve(session.projectRoot);
  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(baseRoot, rawPath);

  let canonicalPath = resolvedPath;
  try {
    canonicalPath = await realpath(resolvedPath);
  } catch {
    // File may not exist yet; fall back to resolved path
  }

  const normalizedRoot = baseRoot.endsWith(path.sep)
    ? baseRoot
    : `${baseRoot}${path.sep}`;

  if (canonicalPath !== baseRoot && !canonicalPath.startsWith(normalizedRoot)) {
    throw new Error(
      `Access denied (outside project root): ${canonicalPath} (root: ${baseRoot})`
    );
  }

  return canonicalPath;
}

export class FileSystemAdapter implements FileSystemPort {
  constructor(private sessionRuntime: SessionRuntimePort) {}

  private getSession(chatId: string): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new Error("Session not found");
    }
    return session;
  }

  async readTextFile(chatId: string, path: string): Promise<string> {
    const session = this.getSession(chatId);
    const filePath = await resolvePathInSessionImpl(session, path);
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new Error(`File not found: ${filePath}`);
        }
      }
      throw error;
    }
  }

  async readTextFileLines(
    chatId: string,
    filePath: string,
    line?: number,
    limit?: number
  ): Promise<string> {
    const content = await this.readTextFile(chatId, filePath);
    if (line !== undefined || limit !== undefined) {
      const startLine = Math.max((line ?? 1) - 1, 0);
      if (limit !== undefined && limit <= 0) {
        return "";
      }
      const lines = content.split(LINE_SPLITTER_REGEX);
      const endLine = limit ? startLine + limit : undefined;
      return lines.slice(startLine, endLine).join("\n");
    }
    return content;
  }

  async writeTextFile(
    chatId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const session = this.getSession(chatId);
    const resolvedPath = await resolvePathInSessionImpl(session, filePath);
    await writeFile(resolvedPath, content, "utf8");
  }

  async resolvePathInSession(
    chatId: string,
    inputPath: string
  ): Promise<string> {
    const session = this.getSession(chatId);
    return await resolvePathInSessionImpl(session, inputPath);
  }
}
