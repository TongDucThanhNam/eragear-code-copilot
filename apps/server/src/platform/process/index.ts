/**
 * Agent Runtime Adapter
 *
 * Implements the runtime interface for spawning agent processes.
 * Creates ACP (Agent Client Protocol) connections for communication.
 *
 * @module infra/process
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { Client } from "@agentclientprotocol/sdk";
import type { AgentRuntimePort } from "@/modules/session";
import {
  filterEnvAllowlist,
  isCommandAllowed,
} from "@/shared/utils/allowlist.util";
import { ENV } from "../../config/environment";
import { createAcpConnectionAdapter } from "../acp/connection";
import { createLogger } from "../logging/structured-logger";

const logger = createLogger("Server");
const STDERR_LOG_INTERVAL_MS = 5000;
const STDERR_SAMPLE_CHAR_LIMIT = 2000;
const STDERR_SAMPLE_LINE_LIMIT = 12;

function attachRateLimitedStderrLogger(
  proc: ChildProcess,
  command: string
): void {
  if (!proc.stderr) {
    return;
  }

  let chunkCount = 0;
  let totalBytes = 0;
  let sampleChars = 0;
  let sampleTruncated = false;
  const samples: string[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;

  const resetWindow = () => {
    chunkCount = 0;
    totalBytes = 0;
    sampleChars = 0;
    sampleTruncated = false;
    samples.length = 0;
  };

  const maybeSampleChunk = (chunk: Buffer) => {
    if (sampleChars >= STDERR_SAMPLE_CHAR_LIMIT) {
      sampleTruncated = true;
      return;
    }

    const lines = chunk.toString("utf8").split(/\r?\n/g);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (samples.length >= STDERR_SAMPLE_LINE_LIMIT) {
        sampleTruncated = true;
        break;
      }

      const remainingChars = STDERR_SAMPLE_CHAR_LIMIT - sampleChars;
      if (remainingChars <= 0) {
        sampleTruncated = true;
        break;
      }

      const lineSample = trimmed.slice(0, remainingChars);
      samples.push(lineSample);
      sampleChars += lineSample.length;

      if (lineSample.length < trimmed.length) {
        sampleTruncated = true;
        break;
      }
    }
  };

  const flush = (reason: "interval" | "exit" | "error" | "stderr_close") => {
    if (chunkCount === 0) {
      return;
    }

    logger.warn("Agent stderr summary", {
      pid: proc.pid,
      command,
      reason,
      chunkCount,
      totalBytes,
      sample: samples.join("\n"),
      sampleTruncated,
    });
    resetWindow();
  };

  const ensureFlushTimer = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setInterval(() => {
      flush("interval");
    }, STDERR_LOG_INTERVAL_MS);
    flushTimer.unref?.();
  };

  const cleanup = (reason: "exit" | "error" | "stderr_close") => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flush(reason);
  };

  proc.stderr.on("data", (chunk: Buffer) => {
    if (chunk.byteLength === 0) {
      return;
    }

    chunkCount += 1;
    totalBytes += chunk.byteLength;
    maybeSampleChunk(chunk);
    ensureFlushTimer();
  });

  proc.on("exit", () => cleanup("exit"));
  proc.on("error", () => cleanup("error"));
  proc.stderr.on("close", () => cleanup("stderr_close"));
}

/**
 * AgentRuntimeAdapter - Implements runtime spawning for agent processes
 */
export class AgentRuntimeAdapter implements AgentRuntimePort {
  /**
   * Spawns a new child process with the given command and arguments
   *
   * @param command - The command to execute
   * @param args - Array of command-line arguments
   * @param options - Spawn options including working directory and environment variables
   * @returns The spawned ChildProcess instance
   */
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): ChildProcess {
    if (!isCommandAllowed(command, ENV.allowedAgentCommands)) {
      throw new Error(`Agent command not allowed: ${command}`);
    }

    const env = filterEnvAllowlist(
      { ...process.env, ...options.env },
      ENV.allowedEnvKeys
    );

    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    attachRateLimitedStderrLogger(proc, command);

    const timeoutMs = ENV.agentTimeoutMs;
    if (timeoutMs !== undefined) {
      const timer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGTERM");
        }
      }, timeoutMs);
      proc.on("exit", () => clearTimeout(timer));
      proc.on("error", () => clearTimeout(timer));
    }

    return proc;
  }

  /**
   * Creates an ACP connection adapter for a spawned process
   *
   * @param proc - The spawned child process
   * @param handlers - Client handlers for ACP protocol messages
   * @returns ACP connection adapter instance
   */
  createAcpConnection(proc: ChildProcess, handlers: Client) {
    return createAcpConnectionAdapter(proc, handlers);
  }
}
