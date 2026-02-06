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
import { createLogger } from "@/infra/logging/structured-logger";

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

  let chunkCount = 0;
  proc.stdout.on("data", (chunk) => {
    chunkCount += 1;
    const text = chunk.toString("utf8");
    const trimmed = text.trimStart();
    const logSample = chunkCount <= 20 || chunkCount % 50 === 0;
    if (!logSample) {
      return;
    }
    logger.debug("ACP stdout chunk", {
      pid: proc.pid,
      chunkCount,
      bytes: chunk.length,
      looksLikeJson: trimmed.startsWith("{") || trimmed.startsWith("["),
      hasSessionUpdate:
        text.includes("sessionUpdate") || text.includes("session_update"),
      hasError:
        text.includes('"error"') ||
        text.includes('"Error"') ||
        text.includes("error"),
    });
  });
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
