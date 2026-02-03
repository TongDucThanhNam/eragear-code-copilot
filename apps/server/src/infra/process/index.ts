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
import path from "node:path";
import type { Client } from "@agentclientprotocol/sdk";
import type { AgentRuntimePort } from "@/modules/session/application/ports/agent-runtime.port";
import { ENV } from "../../config/environment";
import { createAcpConnectionAdapter } from "../acp/connection";

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
function filterEnvAllowlist(
  env: Record<string, string | undefined>,
  allowlist: string[]
) {
  if (allowlist.length === 0) {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        filtered[key] = value;
      }
    }
    return filtered;
  }
  const allowed = new Set(allowlist);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(key) && typeof value === "string") {
      filtered[key] = value;
    }
  }
  return filtered;
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
      stdio: ["pipe", "pipe", "inherit"],
      env,
    });

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
