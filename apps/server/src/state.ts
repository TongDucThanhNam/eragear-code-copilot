import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";

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
	| {
			type: "request_permission";
			requestId: string;
			toolCall: unknown;
			options?: unknown;
	  }
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

	// New: Event Emitter for tRPC subscriptions
	emitter: EventEmitter;

	cleanupTimer?: ReturnType<typeof setTimeout>;
	messageBuffer: BroadcastEvent[];

	pendingPermissions: Map<
		string,
		{ resolve: (decision: any) => void; options?: any[] }
	>;
};

export type ConnWithUnstableModel = ClientSideConnection & {
	unstable_setSessionModel: (params: {
		sessionId: string;
		modelId: string;
	}) => Promise<void>;
};

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
}
