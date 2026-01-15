import { type ChildProcess } from "node:child_process";
import { ClientSideConnection } from "@agentclientprotocol/sdk";
import { EventEmitter } from "node:events";

export type RunState = {
	id: string;
	proc: ChildProcess;
	// We might deprecate pure SSE clients for Runs if we move everything to tRPC,
	// but keeping generic 'clients' or just using an emitter is better.
	clients: Set<ReadableStreamDefaultController<string>>;
};

// Chat session state
export type SessionModeState = {
	currentModeId: string;
	availableModes: Array<{
		id: string;
		name: string;
		description?: string | null;
	}>;
};

export type SessionModelState = {
	currentModelId: string;
	availableModels: Array<{
		modelId: string;
		name: string;
		description?: string | null;
	}>;
};

export type BroadcastEvent =
	| { type: "current_mode_update"; modeId: string }
	| { type: "session_update"; update: unknown }
	| { type: "message"; message: unknown }
	| { type: "heartbeat"; ts: number }
	| { type: "error"; error: string };

export type AvailableCommand = {
	name: string;
	description: string;
	input?: { hint: string };
};

export type ChatSession = {
	id: string;
	proc: ChildProcess;
	conn: ClientSideConnection;
	projectRoot: string;
	sessionId?: string; // ACP session ID
	modes?: SessionModeState;
	models?: SessionModelState;
	commands?: AvailableCommand[];

	// Legacy SSE clients (if we keep supporting REST/SSE parallel to tRPC)
	clients: Set<ReadableStreamDefaultController<string>>;

	// New: Event Emitter for tRPC subscriptions
	emitter: EventEmitter;

	cleanupTimer?: Timer;
	messageBuffer: BroadcastEvent[];
};

export type ConnWithUnstableModel = ClientSideConnection & {
	unstable_setSessionModel: (params: {
		sessionId: string;
		modelId: string;
	}) => Promise<void>;
};

export const runs = new Map<string, RunState>();
export const chats = new Map<string, ChatSession>();

// Helper to broadcast to both SSE (legacy) and tRPC Emitter
export function broadcastToSession(chatId: string, event: BroadcastEvent) {
	const session = chats.get(chatId);
	if (!session) return;

	// 1. Buffer
	session.messageBuffer.push(event);

	// 2. Emit to tRPC subscribers
	// console.log(`[Server] Emitting event ${event.type} to tRPC listeners`);
	session.emitter.emit("data", event);

	// 3. Emit to SSE clients (Legacy support / Hybrid)
	const msg = JSON.stringify(event);
	for (const ctl of session.clients) {
		try {
			ctl.enqueue(`data: ${msg}\n\n`);
		} catch (e) {
			console.error(
				`[Server/State] Error broadcasting to SSE client for ${chatId}:`,
				e,
			);
			session.clients.delete(ctl);
		}
	}
}
