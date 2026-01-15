import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { broadcastToSession, type ChatSession, chats } from "./state";
import {
	saveSession,
	updateSessionMetadata,
	updateSessionStatus,
} from "./store";

function fileUriToPath(uri: string) {
	if (uri.startsWith("file://"))
		return decodeURIComponent(uri.replace("file://", ""));
	return uri;
}

export type CreateSessionParams = {
	projectRoot: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	chatId?: string;
};

export async function createChatSession(params: CreateSessionParams) {
	const projectRoot = path.resolve(params.projectRoot);
	const agentCmd = params.command ?? "opencode";
	const agentArgs = params.args ?? ["acp"];
	const agentEnv = params.env ?? {};

	const chatId =
		params.chatId ??
		`chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

	// Spawn agent process
	const proc = spawn(agentCmd, agentArgs, {
		cwd: projectRoot,
		stdio: ["pipe", "pipe", "inherit"],
		env: { ...process.env, ...agentEnv },
	});

	const handlers = {
		async sessionUpdate(p: { update: unknown }) {
			const u = p?.update as any;
			if (u?.sessionUpdate === "agent_message_chunk") {
				// Log logic if needed
			}
			if (u?.sessionUpdate === "current_mode_update") {
				const session = chats.get(chatId);
				if (session?.modes) {
					session.modes.currentModeId = u.modeId;
				}
				updateSessionMetadata(chatId, { modeId: u.modeId });
				console.log(`[Server] Received mode update: ${u.modeId}`);
				broadcastToSession(chatId, {
					type: "current_mode_update",
					modeId: u.modeId,
				});
				return;
			}

			if (u?.sessionUpdate === "available_commands_update") {
				const session = chats.get(chatId);
				if (session) {
					session.commands = u.availableCommands;
				}
				console.log(`[Server] Received commands update`, u.availableCommands);
				broadcastToSession(chatId, {
					type: "session_update",
					update: u,
				});
				return;
			}

			if (u?.sessionUpdate === "agent_message_chunk") {
				// reduce noise, maybe only log length
				// console.log(`[Server] Received chunk of length ${u.content?.length || u.text?.length}`);
			} else {
				console.log(
					`[Server] Received session update: ${u?.sessionUpdate}`,
					JSON.stringify(u, null, 2),
				);
			}

			// Broadcast everything to client
			broadcastToSession(chatId, { type: "session_update", update: u });
		},
		async requestPermission(p: any) {
			const { toolCall } = p;
			const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			console.log(`[Server] Requesting permission: ${requestId}`, toolCall);
			console.log(
				`[Server] Permission options:`,
				JSON.stringify(p.options, null, 2),
			);

			return new Promise((resolve) => {
				const session = chats.get(chatId);
				if (!session) {
					console.log(`[Server] Session not found, rejecting permission`);
					resolve({ outcome: { outcome: "cancelled" } });
					return;
				}

				// Store resolve function
				session.pendingPermissions.set(requestId, {
					resolve,
					options: p.options,
				});

				// Broadcast request
				broadcastToSession(chatId, {
					type: "request_permission",
					requestId,
					toolCall,
					options: p.options,
				});
			});
		},
		async readTextFile(p: any) {
			const { readFile } = await import("node:fs/promises");
			const fpath = fileUriToPath(p?.uri ?? p?.path ?? "");
			try {
				const text = await readFile(fpath, "utf8");
				return { text };
			} catch (e) {
				return { error: String(e) };
			}
		},
		async writeTextFile(p: any) {
			const { writeFile } = await import("node:fs/promises");
			const fpath = fileUriToPath(p?.uri ?? p?.path ?? "");
			await writeFile(fpath, String(p?.text ?? p?.content ?? ""), "utf8");
			return { ok: true };
		},
	};

	const conn = new ClientSideConnection(
		() => handlers as any,
		ndJsonStream(Writable.toWeb(proc.stdin!), Readable.toWeb(proc.stdout!)),
	);

	await conn.initialize({
		protocolVersion: 1,
		clientInfo: { name: "eragear-web-chat", version: "0.0.1" },
		clientCapabilities: {},
	});

	// Allow explicit cwd for the session, default to projectRoot
	const sessionCwd = params.cwd ? path.resolve(params.cwd) : projectRoot;

	const { sessionId, modes, models } = await conn.newSession({
		cwd: sessionCwd,
		mcpServers: [],
	});

	const session: ChatSession = {
		id: chatId,
		proc,
		conn,
		projectRoot,
		sessionId,
		modes: modes ?? undefined,
		models: models ?? undefined,

		emitter: new EventEmitter(),
		messageBuffer: [],
		pendingPermissions: new Map(),
	};
	chats.set(chatId, session);

	// Handle process events
	proc.on("error", (err) => {
		console.error(`[Server] Agent process error for ${chatId}:`, err);
		broadcastToSession(chatId, {
			type: "error",
			error: `Agent process error: ${err.message}`,
		});
		updateSessionStatus(chatId, "stopped");
	});

	proc.on("exit", (code) => {
		console.log(
			`[Server] Agent process for ${chatId} exited with code ${code}`,
		);
		broadcastToSession(chatId, {
			type: "error",
			error: `Agent process exited with code ${code}`,
		});

		updateSessionStatus(chatId, "stopped");

		const s = chats.get(chatId);
		if (s) {
			chats.delete(chatId);
		}
	});

	// Save to store
	saveSession({
		id: chatId,
		sessionId,
		projectRoot,
		command: agentCmd,
		args: agentArgs,
		env: agentEnv,
		cwd: sessionCwd,
		status: "running",
		createdAt: Date.now(),
		lastActiveAt: Date.now(),
		modeId: modes?.currentModeId,
		modelId: models?.currentModelId,
	});

	return { chatId, sessionId, modes, models };
}
