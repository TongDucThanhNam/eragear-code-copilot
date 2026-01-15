import { Hono, type Context } from "hono";
import { logger } from "hono/logger";
import { spawn } from "node:child_process";
import path from "node:path";
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "./trpc";
import {
	chats,
	runs,
	type RunState,
	type ConnWithUnstableModel,
} from "./state";
import { createChatSession } from "./session";

function sseHeaders() {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
	};
}

const app = new Hono();
app.use(logger());

// --- RUNNER API (Batch) ---
app.post("/api/runs", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const rawProjectRoot = body.projectRoot ?? ".";
	const todoPath = body.todoPath ?? "todo.md";

	// Reverting to direct config passing from client
	const agentCmd = body.command ?? "opencode";
	const agentArgs = body.args ?? ["acp"];
	const agentEnv = body.env ?? {};

	let finalProjectRoot = path.resolve(rawProjectRoot);
	if (rawProjectRoot === "." && process.cwd().endsWith("apps/server")) {
		finalProjectRoot = path.resolve(process.cwd(), "../..");
	}

	const runnerScript = path.join(
		finalProjectRoot,
		"packages/runner/src/cli.ts",
	);
	const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;

	console.log(`[Server] Spawning runner: bun ${runnerScript}`);

	const proc = spawn(
		"bun",
		[
			runnerScript,
			"run",
			"--projectRoot",
			finalProjectRoot,
			"--todoPath",
			todoPath,
			"--agentCmd",
			agentCmd,
			"--agentArgs",
			agentArgs.join(" "),
		],
		{
			cwd: finalProjectRoot,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...agentEnv },
		},
	);

	const state: RunState = { id: runId, proc, clients: new Set() };
	runs.set(runId, state);

	const broadcast = (line: string) => {
		for (const ctl of state.clients) ctl.enqueue(`data: ${line}\n\n`);
	};

	proc.stdout.setEncoding("utf8");
	// Note: Do not add a 'data' listener here if the stream is piped elsewhere (like to ACP SDK)
	// as it will compete for chunks and potentially corrupt the stream.
	proc.stderr.setEncoding("utf8");
	proc.stderr.on("data", (chunk) => {
		const lines = String(chunk).split("\n").filter(Boolean);
		for (const line of lines)
			broadcast(
				JSON.stringify({ type: "error", message: line, ts: Date.now() }),
			);
	});
	proc.on("close", () => {
		broadcast(
			JSON.stringify({ type: "run_done", runId, ok: true, ts: Date.now() }),
		);
		for (const ctl of state.clients) ctl.close();
		runs.delete(runId);
	});

	return c.json({ runId });
});

app.get("/api/runs/:id/events", (c) => {
	const runId = c.req.param("id");
	const state = runs.get(runId);
	if (!state) return c.text("Run not found", 404);

	let controllerRef: ReadableStreamDefaultController<string>;
	const stream = new ReadableStream<string>({
		start(controller) {
			controllerRef = controller;
			state.clients.add(controller);
			controller.enqueue(
				`event: ready\ndata: ${JSON.stringify({ runId })}\n\n`,
			);
		},
		cancel() {
			if (state && controllerRef) state.clients.delete(controllerRef);
		},
	});
	return new Response(stream, { headers: sseHeaders() });
});

app.post("/api/runs/:id/stop", (c) => {
	const runId = c.req.param("id");
	const state = runs.get(runId);
	if (!state) return c.json({ ok: false }, 404);
	state.proc.kill();
	return c.json({ ok: true });
});

// --- CHAT API (Interactive) - Mapped to reuse session.ts logic where possible ---

app.post("/api/chat", async (c) => {
	const body = await c.req.json().catch(() => ({}));

	try {
		// Use shared session creator
		const res = await createChatSession({
			projectRoot: body.projectRoot ?? process.cwd(),
			command: body.command,
			args: body.args,
			env: body.env,
			cwd: body.cwd,
		});
		return c.json(res);
	} catch (e) {
		console.error("[Server] Failed to create chat session:", e);
		return c.json({ error: String(e) }, 500);
	}
});

app.post("/api/chat/:id/message", async (c) => {
	const chatId = c.req.param("id");
	const body = await c.req.json();
	const text = body.text;

	const session = chats.get(chatId);
	if (!session || !session.sessionId)
		return c.json({ error: "Chat not found" }, 404);

	// Send prompt
	const res = await session.conn.prompt({
		sessionId: session.sessionId,
		prompt: [{ type: "text", text }],
	});

	return c.json({ stopReason: res.stopReason });
});

app.post("/api/chat/:id/model", async (c: Context) => {
	const chatId = c.req.param("id");
	const body = await c.req.json();
	const modelId = body.modelId;

	const session = chats.get(chatId);
	if (!session || !session.sessionId)
		return c.json({ error: "Chat not found" }, 404);

	await (
		session.conn as unknown as ConnWithUnstableModel
	).unstable_setSessionModel({
		sessionId: session.sessionId,
		modelId,
	});

	if (session.models) {
		session.models.currentModelId = modelId;
	}

	return c.json({ ok: true });
});

app.post("/api/chat/:id/mode", async (c: Context) => {
	const chatId = c.req.param("id");
	const body = await c.req.json();
	const modeId = body.modeId;

	const session = chats.get(chatId);
	if (!session || !session.sessionId)
		return c.json({ error: "Chat not found" }, 404);

	await session.conn.setSessionMode({
		sessionId: session.sessionId,
		modeId,
	});

	if (session.modes) {
		session.modes.currentModeId = modeId;
	}

	return c.json({ ok: true });
});

app.post("/api/chat/:id/stop", (c) => {
	const chatId = c.req.param("id");
	const session = chats.get(chatId);
	if (!session) return c.json({ error: "Chat not found" }, 404);

	session.proc.kill();
	return c.json({ ok: true });
});

app.get("/api/chat/:id/events", (c) => {
	const chatId = c.req.param("id");
	const session = chats.get(chatId);
	if (!session) return c.text("Chat not found", 404);

	let controllerRef: ReadableStreamDefaultController<string>;
	let heartbeatId: Timer | undefined;

	const stream = new ReadableStream<string>({
		start(controller) {
			console.log(
				`[Server] SSE connect request for ${chatId}. Current clients: ${session.clients.size}`,
			);
			if (session.cleanupTimer) {
				clearTimeout(session.cleanupTimer);
				session.cleanupTimer = undefined;
			}
			controllerRef = controller;

			// Send buffered messages immediately
			if (session.messageBuffer.length > 0) {
				console.log(
					`[Server] Replaying ${session.messageBuffer.length} buffered messages for ${chatId}`,
				);
				for (const event of session.messageBuffer) {
					try {
						controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
					} catch (e) {
						console.error(
							`[Server] Error enqueuing buffered message for ${chatId}:`,
							e,
						);
					}
				}
			}

			session.clients.add(controller);

			try {
				controller.enqueue(
					`event: ready\ndata: ${JSON.stringify({ chatId })}\n\n`,
				);
			} catch (e) {
				console.error(`[Server] Error sending ready event for ${chatId}:`, e);
			}

			// Keep-alive heartbeat every 10s
			heartbeatId = setInterval(() => {
				try {
					controller.enqueue(
						`data: ${JSON.stringify({ type: "heartbeat", ts: Date.now() })}\n\n`,
					);
				} catch {
					if (heartbeatId) clearInterval(heartbeatId);
				}
			}, 10000);
		},
		cancel() {
			if (session && controllerRef) {
				session.clients.delete(controllerRef);
				if (session.clients.size === 0) {
					console.log(
						`[Server] All clients disconnected for ${chatId}, starting 120s grace period.`,
					);
					if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
					session.cleanupTimer = setTimeout(() => {
						session.proc.kill();
						chats.delete(chatId);
					}, 120000);
				}
			}
			if (heartbeatId) clearInterval(heartbeatId);
		},
	});

	return new Response(stream, { headers: sseHeaders() });
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ port: 3003 });
const handler = applyWSSHandler({
	wss,
	router: appRouter,
	createContext: () => ({}),
});

console.log("[Server] WebSocket Server running on ws://localhost:3003");

process.on("SIGTERM", () => {
	handler.broadcastReconnectNotification();
	wss.close();
});

export default app;
