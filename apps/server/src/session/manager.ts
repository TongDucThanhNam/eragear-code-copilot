import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { createAcpConnection } from "../acp/client";
import { createSessionHandlers, SessionBuffering } from "../acp/protocol/handler";
import { CLIENT_INFO } from "../config/constants";
import { broadcastToSession, chats } from "./events";
import type { ChatSession } from "./types";
import {
	getSessionMessages,
	saveSession,
	type StoredMessage,
	updateSessionMetadata,
	updateSessionStatus,
} from "./storage";

export type CreateSessionParams = {
	projectRoot: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	chatId?: string;
	sessionIdToLoad?: string;
};

function resolveSessionCwd(projectRoot: string, cwd?: string) {
	return cwd ? path.resolve(cwd) : projectRoot;
}

function buildAgentInfo(info?: {
	name?: string | null;
	title?: string | null;
	version?: string | null;
} | null): ChatSession["agentInfo"] {
	if (!info) return undefined;
	return {
		name: info.name ?? undefined,
		title: info.title ?? undefined,
		version: info.version ?? undefined,
	};
}

function broadcastStoredMessage(chatId: string, message: StoredMessage) {
	if (message.role === "user") {
		if (!message.content) return;
		broadcastToSession(chatId, {
			type: "session_update",
			update: {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: message.content },
			},
		});
		return;
	}

	if (message.reasoning) {
		broadcastToSession(chatId, {
			type: "session_update",
			update: {
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: message.reasoning },
			},
		});
	}

	if (message.content) {
		broadcastToSession(chatId, {
			type: "session_update",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: message.content },
			},
		});
	}
}

function replayStoredMessages(chatId: string) {
	const storedMessages = getSessionMessages(chatId);
	if (storedMessages.length === 0) {
		console.warn(
			`[Server] Agent did not replay history for ${chatId}, and no stored messages were found.`,
		);
		return;
	}

	console.warn(
		`[Server] Agent did not replay history for ${chatId}; replaying ${storedMessages.length} stored messages.`,
	);
	for (const message of storedMessages) {
		broadcastStoredMessage(chatId, message);
	}
}

function attachAgentProcessHandlers(proc: ReturnType<typeof spawn>, chatId: string) {
	proc.on("error", (err) => {
		console.error(`[Server] Agent process error for ${chatId}:`, err);
		broadcastToSession(chatId, {
			type: "error",
			error: `Agent process error: ${err.message}`,
		});
		updateSessionStatus(chatId, "stopped");
	});

	proc.on("exit", (code, signal) => {
		console.log(
			`[Server] Agent process for ${chatId} exited with code ${code}${signal ? ` signal ${signal}` : ""}`,
		);
		const isExpectedSignal = signal === "SIGTERM" || signal === "SIGINT";
		const isCleanExit = code === 0 || (code === null && isExpectedSignal);

		if (!isCleanExit) {
			const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
			broadcastToSession(chatId, {
				type: "error",
				error: `Agent process exited with ${reason}`,
			});
		}

		updateSessionStatus(chatId, "stopped");

		const session = chats.get(chatId);
		if (session) {
			chats.delete(chatId);
		}
	});
}

export async function createChatSession(params: CreateSessionParams) {
	const projectRoot = path.resolve(params.projectRoot);
	const agentCmd = params.command ?? "opencode";
	const agentArgs = params.args ?? ["acp"];
	const agentEnv = params.env ?? {};
	const chatId = params.chatId ?? crypto.randomUUID();

	const proc = spawn(agentCmd, agentArgs, {
		cwd: projectRoot,
		stdio: ["pipe", "pipe", "inherit"],
		env: { ...process.env, ...agentEnv },
	});

	const buffer = new SessionBuffering();
	let isReplayingHistory = false;

	const handlers = createSessionHandlers(
		chatId,
		buffer,
		() => isReplayingHistory,
	);

	const conn = createAcpConnection(proc, handlers);

	const initResult = await conn.initialize({
		protocolVersion: 1,
		clientInfo: CLIENT_INFO,
		clientCapabilities: {
			fs: { readTextFile: true, writeTextFile: true },
			terminal: true,
		},
	});

	console.log(`[Server] Agent initialized for chat ${chatId}:`, initResult);

	const agentCapabilities = initResult?.agentCapabilities;
	const promptCapabilities = agentCapabilities?.promptCapabilities ?? {};
	const loadSessionSupported = Boolean(agentCapabilities?.loadSession);
	const agentInfo = buildAgentInfo(initResult?.agentInfo);

	if (params.sessionIdToLoad && !loadSessionSupported) {
		proc.kill();
		throw new Error("Agent does not support session/load");
	}

	const sessionCwd = resolveSessionCwd(projectRoot, params.cwd);
	const session: ChatSession = {
		id: chatId,
		proc,
		conn,
		projectRoot,
		cwd: sessionCwd,
		sessionId: params.sessionIdToLoad,
		loadSessionSupported,
		agentInfo,
		promptCapabilities,
		emitter: new EventEmitter(),
		subscriberCount: 0,
		messageBuffer: [],
		pendingPermissions: new Map(),
		terminals: new Map(),
	};

	if (session.sessionId) {
		chats.set(chatId, session);
		try {
			console.log(
				`[Server] Loading session ${session.sessionId} for chat ${chatId}`,
			);
			isReplayingHistory = true;
			const loadResult = await conn.loadSession({
				sessionId: session.sessionId,
				cwd: sessionCwd,
				mcpServers: [],
			});
			isReplayingHistory = false;

			session.modes = loadResult.modes ?? undefined;
			session.models = loadResult.models ?? undefined;

			if (buffer.replayEventCount === 0) {
				replayStoredMessages(chatId);
			} else {
				console.log(
					`[Server] Replayed ${buffer.replayEventCount} history chunks for ${chatId}`,
				);
			}
		} catch (err) {
			isReplayingHistory = false;
			chats.delete(chatId);
			proc.kill();
			throw err;
		}
	} else {
		const newResult = await conn.newSession({
			cwd: sessionCwd,
			mcpServers: [],
		});

		console.log(`[Server] Created new session for chat ${chatId}:`, newResult);
		session.sessionId = newResult.sessionId;
		session.modes = newResult.modes ?? undefined;
		session.models = newResult.models ?? undefined;
		chats.set(chatId, session);
	}

	attachAgentProcessHandlers(proc, chatId);

	const commonSessionData = {
		projectRoot,
		command: agentCmd,
		args: agentArgs,
		env: agentEnv,
		cwd: sessionCwd,
		agentInfo,
		loadSessionSupported,
		status: "running" as const,
		modeId: session.modes?.currentModeId,
		modelId: session.models?.currentModelId,
	};

	if (params.sessionIdToLoad) {
		updateSessionMetadata(chatId, {
			sessionId: session.sessionId,
			...commonSessionData,
		});
	} else {
		saveSession({
			id: chatId,
			sessionId: session.sessionId,
			...commonSessionData,
			createdAt: Date.now(),
			lastActiveAt: Date.now(),
			messages: [],
		});
	}

	return {
		chatId,
		sessionId: session.sessionId,
		modes: session.modes,
		models: session.models,
		promptCapabilities,
		loadSessionSupported,
	};
}
