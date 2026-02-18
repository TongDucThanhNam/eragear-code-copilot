import { realpath } from "node:fs/promises";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession, TerminalState } from "@/shared/types/session.types";
import { fileUriToPath } from "@/shared/utils/path.util";
import {
  hasProcessExited,
  terminateProcessGracefully,
} from "@/shared/utils/process-termination.util";

/** Regex for splitting text into lines across platforms */
export const LINE_SPLITTER_REGEX = /\r?\n/;

export function resolveOutputLimit(
  limit: bigint | number | null | undefined
): number {
  if (limit === null || limit === undefined) {
    return ENV.terminalOutputHardCapBytes;
  }

  let normalized = 0;
  if (typeof limit === "bigint") {
    if (limit <= 0n) {
      throw RequestError.invalidParams(
        { outputByteLimit: limit },
        "outputByteLimit must be a positive number"
      );
    }
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    normalized = Number(limit > maxSafe ? maxSafe : limit);
  } else {
    if (!Number.isFinite(limit) || limit <= 0) {
      throw RequestError.invalidParams(
        { outputByteLimit: limit },
        "outputByteLimit must be a positive finite number"
      );
    }
    normalized = Math.trunc(limit);
  }

  if (normalized <= 0) {
    throw RequestError.invalidParams(
      { outputByteLimit: limit },
      "outputByteLimit must be a positive number"
    );
  }

  return Math.min(normalized, ENV.terminalOutputHardCapBytes);
}

export function requireString(
  value: unknown,
  field: string,
  options?: { allowEmpty?: boolean }
): string {
  if (typeof value !== "string") {
    throw RequestError.invalidParams(
      { [field]: value },
      `${field} must be a string`
    );
  }
  if (!options?.allowEmpty && value.trim().length === 0) {
    throw RequestError.invalidParams(
      { [field]: value },
      `${field} is required`
    );
  }
  return value;
}

/**
 * Converts environment variable array to a record object
 *
 * @param env - Array of environment variables
 * @returns Record of environment variable names to values
 */
export function envArrayToRecord(env?: acp.EnvVariable[] | null) {
  if (!env || env.length === 0) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const variable of env) {
    record[variable.name] = variable.value;
  }
  return record;
}

/**
 * Gets a session from the runtime or throws if not found
 *
 * @param sessionRuntime - The session runtime port
 * @param chatId - The session identifier
 * @returns The chat session
 * @throws Error if session not found
 */
export function getSessionOrThrow(
  sessionRuntime: SessionRuntimePort,
  chatId: string
) {
  const session = sessionRuntime.get(chatId);
  if (!session) {
    throw new Error("Session not found");
  }
  return session;
}

/**
 * Gets a terminal from a session or throws if not found
 *
 * @param session - The chat session
 * @param terminalId - The terminal identifier
 * @returns The terminal state
 * @throws Error if terminal not found
 */
export function getTerminalOrThrow(
  session: ChatSession,
  terminalId: string
): TerminalState {
  const terminal = session.terminals.get(terminalId);
  if (!terminal) {
    throw new Error("Terminal not found");
  }
  return terminal as TerminalState;
}

export function clearTerminalKillTimer(term: TerminalState): void {
  if (!term.killTimer) {
    return;
  }
  clearTimeout(term.killTimer);
  term.killTimer = undefined;
}

export function isPosixRuntime(): boolean {
  return process.platform !== "win32";
}

export async function terminateTerminalProcess(
  term: TerminalState
): Promise<void> {
  if (term.terminationPromise) {
    await term.terminationPromise;
    return;
  }

  clearTerminalKillTimer(term);
  if (
    term.lifecycleState === "exited" ||
    term.exitStatus ||
    hasProcessExited(term.process)
  ) {
    return;
  }
  term.lifecycleState = "terminating";

  const terminationPromise = terminateProcessGracefully(term.process, {
    processGroupId: term.processGroupId,
    forceWindowsTreeTermination: true,
  }).then(() => undefined);
  term.terminationPromise = terminationPromise;

  try {
    await terminationPromise;
  } finally {
    if (term.terminationPromise === terminationPromise) {
      term.terminationPromise = undefined;
    }
  }
}

export function shouldSkipTimedTermination(term: TerminalState): boolean {
  if (term.lifecycleState === "exited" || term.exitStatus) {
    return true;
  }
  if (hasProcessExited(term.process)) {
    return true;
  }
  if (term.lifecycleState === "terminating" || term.terminationPromise) {
    return true;
  }
  return false;
}

/**
 * Resolves a file path within a session's project root with security checks
 *
 * @param session - The chat session containing project root
 * @param inputPath - The input path (may be file:// URI or relative path)
 * @returns Resolved absolute path within project root
 * @throws Error if path is outside project root
 */
export async function resolvePathInSession(
  session: ChatSession,
  inputPath: string
): Promise<string> {
  const rawPath = fileUriToPath(inputPath);
  const configuredRoot = path.resolve(session.projectRoot);
  let canonicalRoot = configuredRoot;
  try {
    canonicalRoot = await realpath(configuredRoot);
  } catch {
    throw new Error(`Invalid project root: ${configuredRoot}`);
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(canonicalRoot, rawPath);
  const canonicalPath = await canonicalizeTargetPath(resolvedPath);

  if (isPathOutsideRoot(canonicalRoot, canonicalPath)) {
    throw new Error(
      `Access denied (outside project root): ${canonicalPath} (root: ${canonicalRoot})`
    );
  }

  return canonicalPath;
}

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function canonicalizeTargetPath(resolvedPath: string): Promise<string> {
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  const pathSuffix: string[] = [];
  let cursor = resolvedPath;

  while (true) {
    try {
      const canonicalAncestor = await realpath(cursor);
      return path.resolve(canonicalAncestor, ...pathSuffix);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw error;
      }
      pathSuffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}
