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
import {
  hasProcessExited,
  hasProcessGroupAlive,
  terminateProcessGracefully,
} from "@/shared/utils/process-termination.util";
import { createAcpConnectionAdapter } from "../acp/connection";

const TERMINATION_DRAIN_PASSES = 6;
const PROCESS_RECORD_PRUNE_THRESHOLD = 4096;
const PROCESS_RECORD_PRUNE_TARGET = 2048;

export interface AgentRuntimePolicy {
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  agentTimeoutMs?: number;
}

interface TrackedProcess {
  proc: ChildProcess;
  pid: number | null;
  processGroupId?: number;
}

/**
 * AgentRuntimeAdapter - Implements runtime spawning for agent processes
 */
export class AgentRuntimeAdapter implements AgentRuntimePort {
  private readonly trackedProcesses = new Set<TrackedProcess>();
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

  private trackProcess(proc: ChildProcess, detached: boolean): TrackedProcess {
    const pid = typeof proc.pid === "number" && proc.pid > 0 ? proc.pid : null;
    const tracked: TrackedProcess = {
      proc,
      pid,
      processGroupId:
        detached && process.platform !== "win32" && pid !== null
          ? pid
          : undefined,
    };
    const pruneIfSettled = () => {
      if (!this.shouldAttemptTermination(tracked)) {
        this.trackedProcesses.delete(tracked);
      }
    };
    proc.on("exit", pruneIfSettled);
    proc.on("close", pruneIfSettled);
    proc.on("error", pruneIfSettled);
    this.trackedProcesses.add(tracked);
    pruneIfSettled();
    this.pruneCompletedProcessRecords();
    return tracked;
  }

  private shouldAttemptTermination(record: TrackedProcess): boolean {
    if (!hasProcessExited(record.proc)) {
      return true;
    }
    if (
      typeof record.processGroupId === "number" &&
      hasProcessGroupAlive(record.processGroupId)
    ) {
      return true;
    }
    return false;
  }

  private pruneCompletedProcessRecords(): void {
    if (this.trackedProcesses.size < PROCESS_RECORD_PRUNE_THRESHOLD) {
      return;
    }
    for (const record of this.trackedProcesses) {
      if (this.shouldAttemptTermination(record)) {
        continue;
      }
      this.trackedProcesses.delete(record);
      if (this.trackedProcesses.size <= PROCESS_RECORD_PRUNE_TARGET) {
        break;
      }
    }
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
    const detached = process.platform !== "win32";

    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      detached,
    });
    const tracked = this.trackProcess(proc, detached);

    const timeoutMs = this.agentTimeoutMs;
    if (timeoutMs !== undefined) {
      const timer = setTimeout(() => {
        if (!hasProcessExited(proc)) {
          terminateProcessGracefully(proc, {
            processGroupId: tracked.processGroupId,
          }).catch(() => undefined);
        }
      }, timeoutMs);
      timer.unref?.();
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
    const attempted = new Set<TrackedProcess>();
    const failedRecords = new Set<TrackedProcess>();
    const records = [...this.trackedProcesses];

    for (let pass = 0; pass < TERMINATION_DRAIN_PASSES; pass += 1) {
      const pending = records.filter(
        (record) =>
          !attempted.has(record) && this.shouldAttemptTermination(record)
      );
      if (pending.length === 0) {
        break;
      }

      await Promise.all(
        pending.map(async (record) => {
          attempted.add(record);
          const result = await terminateProcessGracefully(record.proc, {
            processGroupId: record.processGroupId,
          });
          if (result.exited) {
            terminated += 1;
            return;
          }
          failed += 1;
          failedRecords.add(record);
        })
      );
    }

    const lingeringRecords = records.filter((record) =>
      this.shouldAttemptTermination(record)
    );
    const lingeringPids = lingeringRecords
      .map((record) => record.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0);
    for (const lingeringRecord of lingeringRecords) {
      if (!failedRecords.has(lingeringRecord)) {
        failed += 1;
      }
    }

    return { terminated, failed, lingeringPids };
  }
}
