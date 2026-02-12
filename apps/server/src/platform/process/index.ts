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
  type CommandPolicy,
  type CommandPolicyRegistry,
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandInvocationAllowed,
} from "@/shared/utils/allowlist.util";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { createAcpConnectionAdapter } from "../acp/connection";

const TERMINATION_DRAIN_PASSES = 6;

export interface AgentRuntimePolicy {
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  agentTimeoutMs?: number;
}

function hasProcessExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * AgentRuntimeAdapter - Implements runtime spawning for agent processes
 */
export class AgentRuntimeAdapter implements AgentRuntimePort {
  private readonly activeProcesses = new Set<ChildProcess>();
  private readonly commandPolicies: CommandPolicyRegistry;
  private readonly allowedEnvKeys: string[];
  private readonly agentTimeoutMs: number | undefined;
  private isShuttingDown = false;

  constructor(policy: AgentRuntimePolicy) {
    this.commandPolicies = compileCommandPolicies(
      policy.allowedAgentCommandPolicies
    );
    this.allowedEnvKeys = [...policy.allowedEnvKeys];
    this.agentTimeoutMs = policy.agentTimeoutMs;
  }

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
    if (this.isShuttingDown) {
      throw new Error("Agent runtime is shutting down; spawn is disabled");
    }
    if (!isCommandInvocationAllowed(command, args, this.commandPolicies)) {
      throw new Error(`Agent command invocation not allowed: ${command}`);
    }

    const env = filterEnvAllowlist(
      { ...process.env, ...options.env },
      this.allowedEnvKeys
    );

    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    this.trackProcess(proc);

    const timeoutMs = this.agentTimeoutMs;
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

  beginShutdown(): void {
    this.isShuttingDown = true;
  }

  async terminateAllActiveProcesses(): Promise<{
    terminated: number;
    failed: number;
    lingeringPids: number[];
  }> {
    let terminated = 0;
    let failed = 0;
    const attempted = new Set<ChildProcess>();
    const failedSet = new Set<ChildProcess>();

    for (let pass = 0; pass < TERMINATION_DRAIN_PASSES; pass += 1) {
      const pending = [...this.activeProcesses].filter(
        (proc) => !(attempted.has(proc) || hasProcessExited(proc))
      );
      if (pending.length === 0) {
        break;
      }

      await Promise.all(
        pending.map(async (proc) => {
          attempted.add(proc);
          const result = await terminateProcessGracefully(proc);
          if (result.exited) {
            terminated += 1;
            return;
          }
          failed += 1;
          failedSet.add(proc);
        })
      );
    }

    const lingeringProcesses = [...this.activeProcesses].filter(
      (proc) => !hasProcessExited(proc)
    );
    const lingeringPids = lingeringProcesses
      .map((proc) => proc.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0);

    for (const lingering of lingeringProcesses) {
      if (!(attempted.has(lingering) && failedSet.has(lingering))) {
        failed += 1;
      }
    }

    return { terminated, failed, lingeringPids };
  }
}
