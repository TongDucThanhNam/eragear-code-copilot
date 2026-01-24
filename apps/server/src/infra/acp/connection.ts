/**
 * ACP Connection Adapter
 *
 * Implements the transport layer for the Agent Client Protocol (ACP).
 * Creates ClientSideConnection instances for bidirectional communication
 * with agent processes using the @agentclientprotocol/sdk library.
 *
 * @module infra/acp/connection
 */

import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Client } from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

/**
 * Creates an ACP connection adapter for a child process
 *
 * @param proc - The child process to communicate with (must have stdin and stdout)
 * @param handlers - Client handlers for incoming messages and lifecycle events
 * @returns ClientSideConnection instance for ACP communication
 * @throws Error if stdin or stdout are not available
 *
 * @example
 * ```typescript
 * const connection = createAcpConnectionAdapter(process, {
 *   handleMessage: (msg) => console.log(msg),
 *   handleError: (err) => console.error(err),
 *   handleClose: (code) => console.log(`Closed with code ${code}`),
 * });
 * ```
 */
export function createAcpConnectionAdapter(
  proc: ChildProcess,
  handlers: Client
) {
  if (!(proc.stdin && proc.stdout)) {
    throw new Error("Child process stdin/stdout are not available");
  }

  return new ClientSideConnection(
    () => handlers,
    ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout))
  );
}
