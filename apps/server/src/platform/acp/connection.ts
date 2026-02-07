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
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Debug");

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

  proc.stdout.on("error", (error) => {
    logger.error("ACP stdout error", error);
  });
  proc.on("exit", (code, signal) => {
    logger.warn("ACP process exit", {
      pid: proc.pid,
      code,
      signal: signal ?? undefined,
    });
  });
  proc.on("error", (error) => {
    logger.error("ACP process error", error, { pid: proc.pid });
  });

  return new ClientSideConnection(
    () => handlers,
    ndJsonStream(
      Writable.toWeb(proc.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>
    )
  );
}
