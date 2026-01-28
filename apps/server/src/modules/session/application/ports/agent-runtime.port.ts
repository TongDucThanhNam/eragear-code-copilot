import type { ChildProcess } from "node:child_process";
import type { Client, ClientSideConnection } from "@agentclientprotocol/sdk";

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
}
