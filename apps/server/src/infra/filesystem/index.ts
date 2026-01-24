/**
 * FileSystem Adapter
 *
 * Implements file system operations for ACP (Agent Client Protocol).
 * Provides secure file reading and writing within session context,
 * with path validation to prevent access outside project root.
 *
 * @module infra/filesystem
 */

import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FileSystemPort,
  SessionRuntimePort,
} from "../../shared/types/ports";
import type { ChatSession } from "../../shared/types/session.types";

/** Regex for splitting text content into lines */
const LINE_SPLITTER_REGEX = /\r?\n/;

/**
 * Converts a file URI to a file system path
 *
 * @param uri - The file URI (e.g., "file:///path/to/file")
 * @returns The decoded file system path
 */
function fileUriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.replace("file://", ""));
  }
  return uri;
}

/**
 * Resolves a file path within a session's project root.
 * Validates that the resolved path stays within the project root.
 *
 * @param session - The chat session
 * @param inputPath - The input file path (may be relative or absolute URI)
 * @returns The resolved absolute file path
 * @throws Error if the path is outside the project root
 */
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

/**
 * FileSystemAdapter - Implements secure file operations for ACP
 *
 * All operations validate that file paths stay within the session's project root.
 */
export class FileSystemAdapter implements FileSystemPort {
  /** The session runtime for accessing session context */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a new FileSystemAdapter
   * @param sessionRuntime - The session runtime for accessing active sessions
   */
  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Gets a session by ID, throwing if not found
   * @param chatId - The chat session ID
   * @returns The chat session
   * @throws Error if session is not found
   */
  private getSession(chatId: string): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new Error("Session not found");
    }
    return session;
  }

  /**
   * Reads a text file from the file system
   *
   * @param chatId - The chat session ID
   * @param path - The file path (can be relative or file:// URI)
   * @returns The file contents as a string
   * @throws Error if file not found or access denied
   */
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

  /**
   * Reads specific lines from a text file
   *
   * @param chatId - The chat session ID
   * @param filePath - The file path
   * @param line - Optional 1-based starting line number
   * @param limit - Optional number of lines to read
   * @returns The requested lines as a string
   */
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

  /**
   * Writes text content to a file
   *
   * @param chatId - The chat session ID
   * @param path - The file path
   * @param content - The text content to write
   * @throws Error if access denied or write fails
   */
  async writeTextFile(
    chatId: string,
    path: string,
    content: string
  ): Promise<void> {
    const session = this.getSession(chatId);
    const resolvedPath = await resolvePathInSessionImpl(session, path);
    await writeFile(resolvedPath, content, "utf8");
  }

  /**
   * Resolves a path within the session's project root
   *
   * @param chatId - The chat session ID
   * @param inputPath - The input path to resolve
   * @returns The resolved absolute path
   */
  async resolvePathInSession(
    chatId: string,
    inputPath: string
  ): Promise<string> {
    const session = this.getSession(chatId);
    return await resolvePathInSessionImpl(session, inputPath);
  }
}
