/**
 * ACP Tool Call Handlers
 *
 * Implements handlers for agent tool calls including file operations and terminal management.
 * Provides secure file access constrained to project roots and manages terminal lifecycle.
 *
 * @module infra/acp/tool-calls
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
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
import { normalizeTimeoutMs } from "@/shared/utils/timeout.util";
import { ENV } from "../../config/environment";
import type { TerminalState } from "../../shared/types/session.types";
import {
  clearTerminalKillTimer,
  envArrayToRecord,
  getSessionOrThrow,
  getTerminalOrThrow,
  isPosixRuntime,
  LINE_SPLITTER_REGEX,
  requireString,
  resolveOutputLimit,
  resolvePathInSession,
  shouldSkipTimedTermination,
  terminateTerminalProcess,
} from "./tool-calls.helpers";

const logger = createLogger("Debug");

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
          throw RequestError.invalidParams(
            { path: requestPath },
            "File not found"
          );
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
      detached: isPosixRuntime(),
    });
    const processGroupId =
      isPosixRuntime() && typeof termProc.pid === "number" && termProc.pid > 0
        ? termProc.pid
        : undefined;

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
      processGroupId,
      lifecycleState: "running",
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
      termState.lifecycleState = "exited";
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
      const normalizedTimeout = normalizeTimeoutMs(terminalTimeoutMs);
      if (normalizedTimeout.clamped) {
        logger.warn(
          "Configured terminal timeout exceeded runtime timer limit",
          {
            chatId,
            terminalId: termId,
            configuredTimeoutMs: terminalTimeoutMs,
            clampedTimeoutMs: normalizedTimeout.timeoutMs,
          }
        );
      }
      termState.killTimer = setTimeout(() => {
        if (shouldSkipTimedTermination(termState)) {
          return;
        }
        terminateTerminalProcess(termState).catch((error) => {
          logger.warn("Failed to terminate timed-out terminal process", {
            chatId,
            terminalId: termId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, normalizedTimeout.timeoutMs);
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
  async function killTerminal(
    chatId: string,
    params: acp.KillTerminalCommandRequest
  ): Promise<acp.KillTerminalCommandResponse> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = getTerminalOrThrow(session, params.terminalId);

    await terminateTerminalProcess(term);
    return {};
  }

  /**
   * Releases (terminates and removes) a terminal
   */
  async function releaseTerminal(
    chatId: string,
    params: acp.ReleaseTerminalRequest
  ): Promise<acp.ReleaseTerminalResponse | undefined> {
    const session = getSessionOrThrow(sessionRuntime, chatId);
    const term = session.terminals.get(params.terminalId);
    if (!term) {
      return undefined;
    }

    const typedTerm = term as TerminalState;
    clearTerminalKillTimer(typedTerm);
    if (!typedTerm.exitStatus) {
      try {
        await terminateTerminalProcess(typedTerm);
      } catch (error) {
        logger.warn("Failed to kill terminal during release", {
          chatId,
          terminalId: params.terminalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    session.terminals.delete(params.terminalId);
    return undefined;
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
