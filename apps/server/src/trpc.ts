import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createChatSession } from "./session";
import {
	chats,
	type BroadcastEvent,
	type ConnWithUnstableModel,
} from "./state";

const t = initTRPC.create();

export const appRouter = t.router({
	// --- Chat Session Management ---

	createSession: t.procedure
		.input(
			z.object({
				projectRoot: z.string().default("."),
				command: z.string().optional(),
				args: z.array(z.string()).optional(),
				env: z.record(z.string(), z.string()).optional(),
				cwd: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			console.log("[tRPC] Creating new session", input);
			const res = await createChatSession(input);
			return res;
		}),

	stopSession: t.procedure
		.input(z.object({ chatId: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) return { ok: false, error: "Chat not found" };

			console.log(`[tRPC] Stopping session ${input.chatId}`);
			session.proc.kill();
			return { ok: true };
		}),

	getProjectContext: t.procedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const projectRoot = session.projectRoot;
			const { readdir } = await import("node:fs/promises");
			const { join, relative } = await import("node:path");

			const projectRules: { path: string; location: string }[] = [];
			const activeTabs: { path: string }[] = [];

			// Helper to scan for .mdc files
			async function scanDir(dir: string, depth = 0) {
				if (depth > 3) return;
				try {
					const entries = await readdir(dir, { withFileTypes: true });
					for (const entry of entries) {
						if (entry.name.startsWith(".") || entry.name === "node_modules")
							continue;
						const fullPath = join(dir, entry.name);
						if (entry.isDirectory()) {
							await scanDir(fullPath, depth + 1);
						} else if (entry.isFile() && entry.name.endsWith(".mdc")) {
							projectRules.push({
								path: entry.name,
								location: relative(projectRoot, dir) || ".",
							});
						}
					}
				} catch {
					// ignore errors
				}
			}

			await scanDir(projectRoot);

			// Active Tabs: currently empty until fully implemented
			// const commonFiles = [...];
			// activeTabs logic removed per user request

			return {
				projectRules,
				activeTabs,
			};
		}),

	getSessionState: t.procedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			return {
				modes: session.modes,
				models: session.models,
				commands: session.commands,
			};
		}),

	// --- Interaction ---

	sendMessage: t.procedure
		.input(z.object({ chatId: z.string(), text: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session || !session.sessionId) {
				throw new Error("Chat not found");
			}

			// Send prompt
			console.log(`[tRPC] Sending message to ${input.chatId}`);
			// Note: This promise resolves when the agent *accepts* the prompt,
			// response chunks come via subscription.
			const res = await session.conn.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: input.text }],
			});

			return { stopReason: res.stopReason };
		}),

	setModel: t.procedure
		.input(z.object({ chatId: z.string(), modelId: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session || !session.sessionId) {
				throw new Error("Chat not found");
			}

			console.log(
				`[tRPC] Setting model to ${input.modelId} for ${input.chatId}`,
			);
			await (
				session.conn as unknown as ConnWithUnstableModel
			).unstable_setSessionModel({
				sessionId: session.sessionId,
				modelId: input.modelId,
			});

			if (session.models) {
				session.models.currentModelId = input.modelId;
			}
			return { ok: true };
		}),

	setMode: t.procedure
		.input(z.object({ chatId: z.string(), modeId: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session || !session.sessionId) {
				throw new Error("Chat not found");
			}

			console.log(`[tRPC] Setting mode to ${input.modeId} for ${input.chatId}`);
			await session.conn.setSessionMode({
				sessionId: session.sessionId,
				modeId: input.modeId,
			});

			if (session.modes) {
				session.modes.currentModeId = input.modeId;
			}
			return { ok: true };
		}),

	// --- Realtime Events ---

	onSessionEvents: t.procedure
		.input(z.object({ chatId: z.string() }))
		.subscription(({ input }) => {
			return observable<BroadcastEvent>((emit) => {
				const session = chats.get(input.chatId);
				if (!session) {
					emit.error(new Error("Chat not found"));
					return;
				}

				console.log(`[tRPC] Client subscribed to events for ${input.chatId}`);

				// 1. Replay buffer
				for (const event of session.messageBuffer) {
					emit.next(event);
				}

				// 2. Event handler
				const onData = (data: BroadcastEvent) => {
					emit.next(data);
				};

				session.emitter.on("data", onData);

				// 3. Heartbeat (optional, if we want strict keep-alive visible to tRPC)
				// tRPC over WS handles ping/pong, but let's keep sending app-level heartbeat if useful
				// or rely on WS level. WS level is usually enough.
				// The buffer replay includes heartbeats though?
				// No, buffer likely grows large if we keep heartbeats.
				// Wait, `BroadcastEvent` includes heartbeat.
				// For now let's trust WS keepalive, but if we need app-level debug, it's there.

				return () => {
					console.log(`[tRPC] Client unsubscribed from ${input.chatId}`);
					session.emitter.off("data", onData);
				};
			});
		}),
});

export type AppRouter = typeof appRouter;
