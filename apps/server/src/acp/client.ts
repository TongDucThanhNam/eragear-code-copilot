import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Client } from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

export function createAcpConnection(proc: ChildProcess, handlers: Client) {
  if (!(proc.stdin && proc.stdout)) {
    throw new Error("Child process stdin/stdout are not available");
  }

  return new ClientSideConnection(
    () => handlers,
    ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout))
  );
}
