/**
 * ACP Tool Call Handlers
 *
 * Implements handlers for agent tool calls including file operations and terminal management.
 * Provides secure file access constrained to project roots and manages terminal lifecycle.
 *
 * @module infra/acp/tool-calls
 */

import { spawn } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import type { SessionRuntimePort } from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import {
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandInvocationAllowed,
} from "@/shared/utils/allowlist.util";
import { createId } from "@/shared/utils/id.util";
import { fileUriToPath } from "@/shared/utils/path.util";
import { ENV } from "../../config/environment";
import type {
  ChatSession,
  TerminalState,
} from "../../shared/types/session.types";

/** Regex for splitting text into lines across platforms */
const LINE_SPLITTER_REGEX = /\r?\n/;
const logger = createLogger("Debug");

function resolveOutputLimit(limit: bigint | number | null | undefined): number {
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

function requireString(
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
function envArrayToRecord(env?: acp.EnvVariable[] | null) {
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
function getSessionOrThrow(sessionRuntime: SessionRuntimePort, chatId: string) {
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
function getTerminalOrThrow(
  session: ChatSession,
  terminalId: string
): TerminalState {
  const terminal = session.terminals.get(terminalId);
  if (!terminal) {
    throw new Error("Terminal not found");
  }
  return terminal as TerminalState;
}

function clearTerminalKillTimer(term: TerminalState): void {
  if (!term.killTimer) {
    return;
  }
  clearTimeout(term.killTimer);
  term.killTimer = undefined;
}

/**
 * Resolves a file path within a session's project root with security checks
 *
 * @param session - The chat session containing project root
 * @param inputPath - The input path (may be file:// URI or relative path)
 * @returns Resolved absolute path within project root
 * @throws Error if path is outside project root
 */
async function resolvePathInSession(
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

/**
 * Creates tool call handlers for a session runtime
 *
 * @param sessionRuntime - The session runtime port for session access
 * @returns Object containing all tool call handler functions
 *
 * @example
 * ```typescript
 * const handlers = createToolCallHandlers(sessionRuntime);
 * await handlers.readTextFileForChat("session-123", { path: "README.md" });
 * ```
 */
export function createToolCallHandlers(sessionRuntime: SessionRuntimePort) {
  const terminalCommandPolicies = compileCommandPolicies(
    ENV.allowedTerminalCommandPolicies
  );

  /**
   * Reads a text file within a chat session
   */
  async function readTextFileForChat(
    chatId: string,
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const requestPath = requireString(params.path, "path");
    const filePath = await resolvePathInSession(session, requestPath);
    try {
      const text = await readFile(filePath, "utf8");
      const line = params.line ?? undefined;
      const limit = params.limit ?? undefined;

      // Handle line/limit slicing if requested
      if (line !== undefined || limit !== undefined) {
        const startLine = Math.max((line ?? 1) - 1, 0);
        if (limit !== undefined && limit <= 0) {
          return { content: "" };
        }
        const lines = text.split(LINE_SPLITTER_REGEX);
        const endLine = limit ? startLine + limit : undefined;
        return { content: lines.slice(startLine, endLine).join("\n") };
      }

      return { content: text };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          logger.debug("readTextFile missing file; returning empty content", {
            chatId,
            path: filePath,
          });
          return { content: "" };
        }
      }
      throw error;
    }
  }

  /**
   * Writes a text file within a chat session
   */
  async function writeTextFileForChat(
    chatId: string,
    params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const requestPath = requireString(params.path, "path");
    const content = requireString(params.content, "content", {
      allowEmpty: true,
    });
    const filePath = await resolvePathInSession(session, requestPath);
    await writeFile(filePath, content, "utf8");
    return {};
  }

  /**
   * Creates a new terminal process
   */
  async function createTerminal(
    chatId: string,
    params: acp.CreateTerminalRequest
  ): Promise<acp.CreateTerminalResponse> {
    const termId = createId("term");
    logger.debug("Creating terminal for ACP tool call", {
      chatId,
      terminalId: termId,
      command: params.command,
      argsCount: params.args?.length ?? 0,
      hasCwd: Boolean(params.cwd),
    });

    const session = getSessionOrThrow(sessionRuntime, chatId);
    const sessionCwd = session.projectRoot;
    const targetCwd = params.cwd
      ? path.resolve(sessionCwd, params.cwd)
      : sessionCwd;
    const allowedCwd = await resolvePathInSession(session, targetCwd);
    const outputByteLimit = resolveOutputLimit(params.outputByteLimit ?? null);

    if (
      !isCommandInvocationAllowed(
        params.command,
        params.args ?? [],
        terminalCommandPolicies
      )
    ) {
      throw RequestError.invalidParams(
        { command: params.command, args: params.args ?? [] },
        "Command invocation not allowed"
      );
    }

    const mergedEnv = {
      ...process.env,
      ...envArrayToRecord(params.env ?? null),
    } as Record<string, string>;
    const filteredEnv = filterEnvAllowlist(mergedEnv, ENV.allowedEnvKeys);

    // Spawn the terminal process
    const termProc = spawn(params.command, params.args ?? [], {
      cwd: allowedCwd,
      env: filteredEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Store terminal state
    let resolveExit:
      | ((status: acp.WaitForTerminalExitResponse) => void)
      | undefined;
    const exitPromise = new Promise<acp.WaitForTerminalExitResponse>(
      (resolve) => {
        resolveExit = resolve;
      }
    );

    const termState: TerminalState = {
      id: termId,
      process: termProc,
      outputBuffer: "",
      outputBufferBytes: Buffer.alloc(0),
      outputByteLimit,
      truncated: false,
      exitPromise,
      resolveExit,
    };

    session.terminals.set(termId, termState);

    const finalizeTerminal = (status: acp.WaitForTerminalExitResponse) => {
      if (termState.exitStatus) {
        return;
      }
      termState.exitStatus = status;
      termState.resolveExit?.(status);
      termState.resolveExit = undefined;
      clearTerminalKillTimer(termState);
    };

    // Handle output streaming
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const current = termState.outputBufferBytes ?? Buffer.alloc(0);
      let next = current.length === 0 ? chunk : Buffer.concat([current, chunk]);
      if (next.length > outputByteLimit) {
        next = next.subarray(next.length - outputByteLimit);
        termState.truncated = true;
      }
      termState.outputBufferBytes = next;
      termState.outputBuffer = next.toString("utf8");

      const publishOutput = sessionRuntime.broadcast(chatId, {
        type: "terminal_output",
        terminalId: termId,
        data: text,
      });
      publishOutput.catch((error) => {
        logger.error(
          "Failed to publish terminal output event",
          error as Error,
          {
            chatId,
            terminalId: termId,
          }
        );
      });
    };

    termProc.stdout?.on("data", handleOutput);
    termProc.stderr?.on("data", handleOutput);

    // Handle process exit
    termProc.on("exit", (code, signal) => {
      finalizeTerminal({ exitCode: code, signal });
    });

    termProc.on("error", (err) => {
      logger.error("Terminal process emitted runtime error", err as Error, {
        chatId,
        terminalId: termId,
      });
      finalizeTerminal({ exitCode: null, signal: null });
    });

    const terminalTimeoutMs = ENV.terminalTimeoutMs;
    if (terminalTimeoutMs !== undefined) {
      termState.killTimer = setTimeout(() => {
        if (termState.exitStatus || termProc.killed) {
          return;
        }
        try {
          termProc.kill("SIGTERM");
        } catch (error) {
          logger.warn("Failed to terminate timed-out terminal process", {
            chatId,
            terminalId: termId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, terminalTimeoutMs);
    }

    return { terminalId: termId };
  }

  /**
   * Waits for a terminal to exit
   */
  function waitForTerminalExit(
    chatId: string,
    params: acp.WaitForTerminalExitRequest
  ): Promise<acp.WaitForTerminalExitResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);
    return term.exitPromise;
  }

  /**
   * Retrieves terminal output
   */
  function terminalOutput(
    chatId: string,
    params: acp.TerminalOutputRequest
  ): Promise<acp.TerminalOutputResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);

    return Promise.resolve({
      output: term.outputBuffer,
      truncated: term.truncated ?? false,
      exitStatus: term.exitStatus ?? null,
    });
  }

  /**
   * Kills a terminal process
   */
  function killTerminal(
    chatId: string,
    params: acp.KillTerminalCommandRequest
  ): Promise<acp.KillTerminalCommandResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);

    term.process.kill();
    return Promise.resolve({});
  }

  /**
   * Releases (terminates and removes) a terminal
   */
  function releaseTerminal(
    chatId: string,
    params: acp.ReleaseTerminalRequest
  ): Promise<acp.ReleaseTerminalResponse | undefined> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = session.terminals.get(params.terminalId);
    if (!term) {
      return Promise.resolve(undefined);
    }

    const typedTerm = term as TerminalState;
    clearTerminalKillTimer(typedTerm);
    if (!typedTerm.exitStatus) {
      try {
        typedTerm.process.kill();
      } catch (error) {
        logger.warn("Failed to kill terminal during release", {
          chatId,
          terminalId: params.terminalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    session.terminals.delete(params.terminalId);
    return Promise.resolve(undefined);
  }

  return {
    readTextFileForChat,
    writeTextFileForChat,
    createTerminal,
    waitForTerminalExit,
    terminalOutput,
    killTerminal,
    releaseTerminal,
  };
}
