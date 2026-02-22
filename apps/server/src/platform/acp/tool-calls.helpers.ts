import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type * as acp from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession, TerminalState } from "@/shared/types/session.types";
import { resolvePathWithinRoot } from "@/shared/utils/path-within-root.util";
import {
  hasProcessExited,
  terminateProcessGracefully,
} from "@/shared/utils/process-termination.util";
import { isPosix } from "@/shared/utils/runtime-platform.util";

/** Regex for splitting text into lines across platforms */
export const LINE_SPLITTER_REGEX = /\r?\n/;

export function sliceTextByLineWindow(params: {
  text: string;
  line?: number;
  limit?: number;
}): string {
  const { text, line, limit } = params;
  if (line === undefined && limit === undefined) {
    return text;
  }
  const startLine = Math.max((line ?? 1) - 1, 0);
  if (limit !== undefined && limit <= 0) {
    return "";
  }
  const normalizedLimit =
    limit === undefined ? undefined : Math.trunc(limit);
  const lines = text.split(LINE_SPLITTER_REGEX);
  const endLine =
    normalizedLimit === undefined ? undefined : startLine + normalizedLimit;
  return lines.slice(startLine, endLine).join("\n");
}

export async function readTextFileLineWindow(params: {
  filePath: string;
  line?: number;
  limit?: number;
  maxBytes?: number;
}): Promise<string> {
  const startLine = Math.max((params.line ?? 1) - 1, 0);
  if (params.limit !== undefined && params.limit <= 0) {
    return "";
  }
  const normalizedLimit =
    params.limit === undefined ? undefined : Math.trunc(params.limit);
  const maxBytes = params.maxBytes ?? ENV.messageContentMaxBytes;

  const input = createReadStream(params.filePath, { encoding: "utf8" });
  const lineReader = createInterface({
    input,
    crlfDelay: Infinity,
  });
  const lines: string[] = [];
  let currentLine = 0;
  let totalBytes = 0;

  try {
    for await (const line of lineReader) {
      if (currentLine >= startLine) {
        const lineBytes = Buffer.byteLength(line, "utf8");
        const separatorBytes = lines.length > 0 ? 1 : 0;
        const nextBytes = totalBytes + separatorBytes + lineBytes;
        if (nextBytes > maxBytes) {
          throw RequestError.invalidParams(
            { filePath: params.filePath, maxBytes },
            "Requested line window exceeds maximum response size."
          );
        }
        lines.push(line);
        totalBytes = nextBytes;
        if (
          normalizedLimit !== undefined &&
          lines.length >= normalizedLimit
        ) {
          lineReader.close();
          input.destroy();
          break;
        }
      }
      currentLine += 1;
    }
  } finally {
    lineReader.close();
    input.destroy();
  }

  return lines.join("\n");
}

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
  return isPosix();
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
  const { canonicalTargetPath } = await resolvePathWithinRoot({
    rootPath: session.projectRoot,
    inputPath,
  });
  return canonicalTargetPath;
}

export async function resolveSessionRootPath(
  session: ChatSession
): Promise<string> {
  const { canonicalRootPath } = await resolvePathWithinRoot({
    rootPath: session.projectRoot,
    inputPath: ".",
  });
  return canonicalRootPath;
}
