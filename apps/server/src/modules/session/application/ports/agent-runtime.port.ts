import type { ChildProcess } from "node:child_process";
import type { Client, ClientSideConnection } from "@agentclientprotocol/sdk";
import type { CommandPolicy } from "@/shared/utils/allowlist.util";

/**
 * Port for agent runtime operations.
 */
export interface AgentRuntimePort {
  /** Spawn a child process for an agent */
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> }
  ): ChildProcess;
  /** Create an ACP connection from a process */
  createAcpConnection(
    proc: ChildProcess,
    handlers: Client
  ): ClientSideConnection;
  /** Prevents new spawns while shutdown cleanup is in progress */
  beginShutdown(): void;
  /** Terminate any tracked runtime processes that are still active */
  terminateAllActiveProcesses(): Promise<{
    terminated: number;
    failed: number;
    lingeringPids: number[];
  }>;
  /** Hot-update invocation policy for future process spawns. */
  updateInvocationPolicy?(policy: {
    allowedAgentCommandPolicies: CommandPolicy[];
    allowedEnvKeys: string[];
  }): void;
}
