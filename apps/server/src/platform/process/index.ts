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
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { ENV } from "../../config/environment";
import { createAcpConnectionAdapter } from "../acp/connection";

/**
 * AgentRuntimeAdapter - Implements runtime spawning for agent processes
 */
export class AgentRuntimeAdapter implements AgentRuntimePort {
  private readonly activeProcesses = new Set<ChildProcess>();

  private trackProcess(proc: ChildProcess): void {
    this.activeProcesses.add(proc);
    const cleanup = () => {
      this.activeProcesses.delete(proc);
      proc.off("exit", cleanup);
      proc.off("error", cleanup);
    };
    proc.on("exit", cleanup);
    proc.on("error", cleanup);
  }

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
    this.trackProcess(proc);

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

  async terminateAllActiveProcesses(): Promise<{
    terminated: number;
    failed: number;
  }> {
    const processes = [...this.activeProcesses];
    let terminated = 0;
    let failed = 0;

    await Promise.all(
      processes.map(async (proc) => {
        const result = await terminateProcessGracefully(proc);
        if (result.exited) {
          terminated += 1;
        } else {
          failed += 1;
        }
        this.activeProcesses.delete(proc);
      })
    );

    return { terminated, failed };
  }
}
