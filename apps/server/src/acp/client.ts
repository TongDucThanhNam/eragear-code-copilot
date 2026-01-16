import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Client } from "@agentclientprotocol/sdk";

export function createAcpConnection(proc: ChildProcess, handlers: Client) {
	return new ClientSideConnection(
		() => handlers,
		ndJsonStream(Writable.toWeb(proc.stdin!), Readable.toWeb(proc.stdout!)),
	);
}
