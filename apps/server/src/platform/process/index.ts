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
import type { AgentRuntimePort } from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
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
import { isPosix, isWindows } from "@/shared/utils/runtime-platform.util";
import { normalizeTimeoutMs } from "@/shared/utils/timeout.util";
import { createAcpConnectionAdapter } from "../acp/connection";

const TERMINATION_DRAIN_PASSES = 6;
const PROCESS_RECORD_RETENTION_MAX = 128;
const PROCESS_RECORD_RETENTION_MS = 60_000;
const WINDOWS_TREE_TERMINATION_GRACE_MS = 10_000;
const FINAL_TERMINATION_TERM_TIMEOUT_MS = 100;
const FINAL_TERMINATION_KILL_TIMEOUT_MS = 1500;
const logger = createLogger("Server");

export interface AgentRuntimePolicy {
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  agentTimeoutMs?: number;
}

interface TrackedProcess {
  proc: ChildProcess;
  pid: number | null;
  trackedAtMs: number;
  settledAtMs?: number;
  processGroupId?: number;
  windowsTreeTerminationDeadlineMs?: number;
}

/**
 * AgentRuntimeAdapter - Implements runtime spawning for agent processes
 */
export class AgentRuntimeAdapter implements AgentRuntimePort {
  private readonly trackedProcesses = new Set<TrackedProcess>();
  private commandPolicies: CommandPolicyRegistry = new Map();
  private allowedEnvKeys: string[] = [];
  private readonly agentTimeoutMs: number | undefined;
  private isShuttingDown = false;

  constructor(policy: AgentRuntimePolicy) {
    this.updateInvocationPolicy({
      allowedAgentCommandPolicies: policy.allowedAgentCommandPolicies,
      allowedEnvKeys: policy.allowedEnvKeys,
    });
    this.agentTimeoutMs = policy.agentTimeoutMs;
  }

  updateInvocationPolicy(policy: {
    allowedAgentCommandPolicies: CommandPolicy[];
    allowedEnvKeys: string[];
  }): void {
    this.commandPolicies = compileCommandPolicies(
      policy.allowedAgentCommandPolicies
    );
    this.allowedEnvKeys = [...policy.allowedEnvKeys];
  }

  private normalizeCommandAlias(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return normalized;
    }
    return isWindows() ? normalized.toLowerCase() : normalized;
  }

  private isBasenameCommand(command: string): boolean {
    return path.basename(command) === command;
  }

  private resolveAllowedCommandAlias(command: string): string {
    if (path.isAbsolute(command)) {
      return command;
    }
    if (!this.isBasenameCommand(command)) {
      return command;
    }

    const alias = this.normalizeCommandAlias(command);
    if (!alias) {
      return command;
    }

    let matchedCommand: string | null = null;
    for (const allowedCommand of this.commandPolicies.keys()) {
      const allowedAlias = this.normalizeCommandAlias(
        path.basename(allowedCommand)
      );
      if (allowedAlias !== alias) {
        continue;
      }
      if (matchedCommand !== null) {
        throw new Error(
          `Agent command alias is ambiguous and not allowed: ${command}`
        );
      }
      matchedCommand = allowedCommand;
    }

    return matchedCommand ?? command;
  }

  private trackProcess(proc: ChildProcess, detached: boolean): TrackedProcess {
    const pid = typeof proc.pid === "number" && proc.pid > 0 ? proc.pid : null;
    const trackedAtMs = Date.now();
    const tracked: TrackedProcess = {
      proc,
      pid,
      trackedAtMs,
      processGroupId: detached && isPosix() && pid !== null ? pid : undefined,
      windowsTreeTerminationDeadlineMs:
        isWindows() && pid !== null
          ? trackedAtMs + WINDOWS_TREE_TERMINATION_GRACE_MS
          : undefined,
    };
    const pruneIfSettled = () => {
      this.markProcessSettled(tracked);
      if (!this.shouldAttemptTermination(tracked)) {
        this.trackedProcesses.delete(tracked);
      }
      this.pruneCompletedProcessRecords();
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
      isWindows() &&
      typeof record.windowsTreeTerminationDeadlineMs === "number" &&
      Date.now() < record.windowsTreeTerminationDeadlineMs
    ) {
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

  private markProcessSettled(record: TrackedProcess): void {
    if (record.settledAtMs === undefined && hasProcessExited(record.proc)) {
      record.settledAtMs = Date.now();
    }
  }

  private pruneCompletedProcessRecords(options?: { force?: boolean }): void {
    const now = Date.now();
    const removableRecords: TrackedProcess[] = [];

    for (const record of this.trackedProcesses) {
      if (this.shouldAttemptTermination(record)) {
        continue;
      }

      this.markProcessSettled(record);
      const settledAtMs = record.settledAtMs ?? record.trackedAtMs;
      const overCapacity =
        this.trackedProcesses.size - removableRecords.length >
        PROCESS_RECORD_RETENTION_MAX;
      const expired = now - settledAtMs >= PROCESS_RECORD_RETENTION_MS;

      if (options?.force || overCapacity || expired) {
        removableRecords.push(record);
      }
    }

    for (const record of removableRecords) {
      this.trackedProcesses.delete(record);
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
    const resolvedCommand = this.resolveAllowedCommandAlias(command);
    if (
      !isCommandInvocationAllowed(resolvedCommand, args, this.commandPolicies)
    ) {
      throw new Error(`Agent command invocation not allowed: ${command}`);
    }

    const env = filterEnvAllowlist(
      { ...process.env, ...options.env },
      this.allowedEnvKeys
    );
    const detached = isPosix();

    const proc = spawn(resolvedCommand, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      detached,
    });
    const tracked = this.trackProcess(proc, detached);

    const timeoutMs = this.agentTimeoutMs;
    if (timeoutMs !== undefined) {
      const normalizedTimeout = normalizeTimeoutMs(timeoutMs);
      if (normalizedTimeout.clamped) {
        logger.warn("Configured agent timeout exceeded runtime timer limit", {
          configuredTimeoutMs: timeoutMs,
          clampedTimeoutMs: normalizedTimeout.timeoutMs,
        });
      }
      const timer = setTimeout(() => {
        if (!hasProcessExited(proc)) {
          terminateProcessGracefully(proc, {
            processGroupId: tracked.processGroupId,
            forceWindowsTreeTermination: true,
          }).catch(() => undefined);
        }
      }, normalizedTimeout.timeoutMs);
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
    const attempted = new Set<TrackedProcess>();
    const terminatedRecords = new Set<TrackedProcess>();
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
            forceWindowsTreeTermination: true,
          });
          if (result.exited) {
            this.markProcessSettled(record);
            terminatedRecords.add(record);
            failedRecords.delete(record);
            return;
          }
          failedRecords.add(record);
        })
      );
    }

    const pendingFinalPass = records.filter((record) =>
      this.shouldAttemptTermination(record)
    );
    if (pendingFinalPass.length > 0) {
      await Promise.all(
        pendingFinalPass.map(async (record) => {
          attempted.add(record);
          const result = await terminateProcessGracefully(record.proc, {
            processGroupId: record.processGroupId,
            forceWindowsTreeTermination: true,
            termTimeoutMs: FINAL_TERMINATION_TERM_TIMEOUT_MS,
            killTimeoutMs: FINAL_TERMINATION_KILL_TIMEOUT_MS,
          });
          if (result.exited) {
            this.markProcessSettled(record);
            terminatedRecords.add(record);
            failedRecords.delete(record);
            return;
          }
          failedRecords.add(record);
        })
      );
    }

    const lingeringRecords = records.filter((record) =>
      this.shouldAttemptTermination(record)
    );
    for (const lingeringRecord of lingeringRecords) {
      failedRecords.add(lingeringRecord);
    }
    const lingeringPids = lingeringRecords
      .map((record) => record.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0);
    const summary = {
      terminated: terminatedRecords.size,
      failed: failedRecords.size,
      lingeringPids,
    };

    if (summary.failed > 0 || lingeringPids.length > 0) {
      logger.warn("Agent runtime shutdown completed with lingering processes", {
        attempted: attempted.size,
        terminated: summary.terminated,
        failed: summary.failed,
        lingeringPids,
      });
    } else {
      logger.info("Agent runtime shutdown completed", {
        attempted: attempted.size,
        terminated: summary.terminated,
      });
    }

    this.pruneCompletedProcessRecords({ force: true });
    return summary;
  }
}
