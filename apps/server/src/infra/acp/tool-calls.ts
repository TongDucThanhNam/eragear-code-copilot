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
import { createId } from "@/shared/utils/id.util";
import { fileUriToPath } from "@/shared/utils/path.util";
import { ENV } from "../../config/environment";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type {
  ChatSession,
  TerminalState,
} from "../../shared/types/session.types";

/** Regex for splitting text into lines across platforms */
const LINE_SPLITTER_REGEX = /\r?\n/;

/**
 * Checks whether a command is allowed based on an allowlist.
 * Empty allowlist means allow all commands.
 */
function isCommandAllowed(command: string, allowlist: string[]) {
  if (allowlist.length === 0) {
    return true;
  }
  const normalized = command.trim();
  const base = path.basename(normalized);
  return allowlist.includes(normalized) || allowlist.includes(base);
}

/**
 * Filters environment variables by allowlist.
 * Empty allowlist means allow all variables.
 */
function filterEnvAllowlist(env: Record<string, string>, allowlist: string[]) {
  if (allowlist.length === 0) {
    return env;
  }
  const allowed = new Set(allowlist);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Normalizes the output limit value, handling bigint, number, and null/undefined cases
 *
 * @param limit - The limit value from the request
 * @returns Normalized limit as a number or undefined
 */
function normalizeOutputLimit(limit?: bigint | number | null) {
  if (limit === null || limit === undefined) {
    return undefined;
  }
  if (typeof limit === "bigint") {
    if (limit <= 0n) {
      return undefined;
    }
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(limit > maxSafe ? maxSafe : limit);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(limit, Number.MAX_SAFE_INTEGER);
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
  /**
   * Reads a text file within a chat session
   */
  async function readTextFileForChat(
    chatId: string,
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const filePath = await resolvePathInSession(session, params.path);
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
          throw RequestError.resourceNotFound(filePath);
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
    const filePath = await resolvePathInSession(session, params.path);
    await writeFile(filePath, params.content, "utf8");
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
    console.log(
      `[Server] Creating terminal ${termId}: ${params.command} ${params.args?.join(" ")}`
    );

    const session = getSessionOrThrow(sessionRuntime, chatId);
    const sessionCwd = session.projectRoot;
    const targetCwd = params.cwd
      ? path.resolve(sessionCwd, params.cwd)
      : sessionCwd;
    const allowedCwd = await resolvePathInSession(session, targetCwd);
    const outputByteLimit = normalizeOutputLimit(
      params.outputByteLimit ?? null
    );

    if (!isCommandAllowed(params.command, ENV.allowedTerminalCommands)) {
      throw RequestError.invalidParams(
        { command: params.command },
        "Command not allowed"
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
    const termState: TerminalState = {
      id: termId,
      process: termProc,
      outputBuffer: "",
      outputBufferBytes: outputByteLimit ? Buffer.alloc(0) : undefined,
      outputByteLimit,
      truncated: false,
      resolveExit: [],
    };

    session.terminals.set(termId, termState);

    // Handle output streaming
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (outputByteLimit === undefined) {
        termState.outputBuffer += text;
      } else {
        const current = termState.outputBufferBytes ?? Buffer.alloc(0);
        let next =
          current.length === 0 ? chunk : Buffer.concat([current, chunk]);
        if (next.length > outputByteLimit) {
          next = next.subarray(next.length - outputByteLimit);
          termState.truncated = true;
        }
        termState.outputBufferBytes = next;
        termState.outputBuffer = next.toString("utf8");
      }

      sessionRuntime.broadcast(chatId, {
        type: "terminal_output",
        terminalId: termId,
        data: text,
      });
    };

    termProc.stdout?.on("data", handleOutput);
    termProc.stderr?.on("data", handleOutput);

    // Handle process exit
    termProc.on("exit", (code, signal) => {
      termState.exitStatus = { exitCode: code, signal };
      for (const resolve of termState.resolveExit) {
        resolve({ exitCode: code, signal });
      }
      termState.resolveExit = [];
      if (termState.killTimer) {
        clearTimeout(termState.killTimer);
        termState.killTimer = undefined;
      }
    });

    termProc.on("error", (err) => {
      console.error(`[Server] Terminal ${termId} error:`, err);
      if (termState.killTimer) {
        clearTimeout(termState.killTimer);
        termState.killTimer = undefined;
      }
    });

    const terminalTimeoutMs = ENV.terminalTimeoutMs;
    if (terminalTimeoutMs !== undefined) {
      termState.killTimer = setTimeout(() => {
        if (!termProc.killed) {
          termProc.kill("SIGTERM");
        }
      }, terminalTimeoutMs);
    }

    return { terminalId: termId };
  }

  /**
   * Waits for a terminal to exit
   */
  async function waitForTerminalExit(
    chatId: string,
    params: acp.WaitForTerminalExitRequest
  ): Promise<acp.WaitForTerminalExitResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);

    if (term.exitStatus) {
      return await term.exitStatus;
    }

    return new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
      term.resolveExit.push(resolve);
    });
  }

  /**
   * Retrieves terminal output
   */
  async function terminalOutput(
    chatId: string,
    params: acp.TerminalOutputRequest
  ): Promise<acp.TerminalOutputResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);

    return await {
      output: term.outputBuffer,
      truncated: term.truncated ?? false,
      exitStatus: term.exitStatus ?? null,
    };
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
    if (!typedTerm.exitStatus) {
      typedTerm.process.kill();
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
