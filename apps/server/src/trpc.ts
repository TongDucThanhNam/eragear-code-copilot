import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { createChatSession } from "./session";
import {
	type BroadcastEvent,
	type ConnWithUnstableModel,
	chats,
} from "./state";
import {
	deleteSession,
	getSession,
	loadSessions,
	updateSessionStatus,
} from "./store";

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
			if (session) {
				console.log(`[tRPC] Stopping session ${input.chatId}`);
				session.proc.kill();
			}
			updateSessionStatus(input.chatId, "stopped");
			return { ok: true };
		}),

	resumeSession: t.procedure
		.input(z.object({ chatId: z.string() }))
		.mutation(async ({ input }) => {
			const stored = getSession(input.chatId);
			if (!stored) {
				throw new Error("Session not found in store");
			}

			// Check if already running
			if (chats.has(input.chatId)) {
				return { ok: true, alreadyRunning: true };
			}

			console.log(`[tRPC] Resuming session ${input.chatId}`);
			// Start new process with same config, reusing ID
			await createChatSession({
				projectRoot: stored.projectRoot,
				command: stored.command,
				args: stored.args,
				env: stored.env,
				cwd: stored.cwd,
				chatId: stored.id,
			});

			return { ok: true };
		}),

	deleteSession: t.procedure
		.input(z.object({ chatId: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (session) {
				session.proc.kill();
			}
			deleteSession(input.chatId);
			if (chats.has(input.chatId)) {
				chats.delete(input.chatId);
			}
			return { ok: true };
		}),

	getProjectContext: t.procedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const projectRoot = session.projectRoot;
			const { readdir } = await import("node:fs/promises");
			const { join, relative, basename, dirname } = await import("node:path");
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			const projectRules: { path: string; location: string }[] = [];
			const activeTabs: { path: string }[] = [];
			let files: string[] = [];

			// Try git ls-files first
			try {
				const { stdout } = await execAsync("git ls-files", {
					cwd: projectRoot,
					maxBuffer: 10 * 1024 * 1024, // 10MB limit
				});
				files = stdout.split("\n").filter((f) => f.trim().length > 0);

				// Populate projectRules from git files
				files.forEach((f) => {
					if (f.endsWith(".mdc")) {
						projectRules.push({
							path: basename(f),
							location: dirname(f) === "." ? "." : dirname(f),
						});
					}
				});
			} catch (e) {
				console.warn(
					"[Server] git ls-files failed, falling back to fs scan",
					e,
				);

				// Fallback to fs scan
				async function scanDir(dir: string, base: string, depth = 0) {
					// Hard limit depth to avoid infinite loops or massive trees
					if (depth > 10) return;

					try {
						const entries = await readdir(dir, { withFileTypes: true });
						for (const entry of entries) {
							if (entry.name.startsWith(".") || entry.name === "node_modules")
								continue;

							const fullPath = join(dir, entry.name);
							const relPath = relative(base, fullPath);

							if (entry.isDirectory()) {
								await scanDir(fullPath, base, depth + 1);
							} else {
								files.push(relPath);
								if (entry.name.endsWith(".mdc")) {
									projectRules.push({
										path: entry.name,
										location: relative(projectRoot, dir) || ".",
									});
								}
							}
						}
					} catch (err) {
						console.error(`Failed to scan ${dir}:`, err);
					}
				}

				await scanDir(projectRoot, projectRoot);
			}

			// Active Tabs: currently empty until fully implemented
			// const commonFiles = [...];
			// activeTabs logic removed per user request

			return {
				projectRules,
				activeTabs,
				files,
			};
		}),

	getGitDiff: t.procedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const projectRoot = session.projectRoot;
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);

			try {
				let combinedPatch = "";

				// 1. Get diff for tracked files (staged + unstaged)
				// git diff HEAD gives us everything changed since the last commit
				try {
					const { stdout } = await execAsync("git diff HEAD", {
						cwd: projectRoot,
					});
					combinedPatch += stdout;
				} catch {
					// Fallback if no HEAD (empty repo), usually won't error but just return empty
				}

				// 2. Get untracked files
				const { stdout: untrackedFilesOutput } = await execAsync(
					"git ls-files --others --exclude-standard",
					{ cwd: projectRoot },
				);
				const untrackedFiles = untrackedFilesOutput
					.split("\n")
					.filter((f) => f.trim().length > 0);

				// 3. Generate patch for each untracked file
				for (const file of untrackedFiles) {
					// Use git diff --no-index /dev/null <file> to generate create patch
					// We need absolute path for the file, but git diff expects relative or handling
					// simpler: cd projectRoot && git diff --no-index /dev/null relative_path
					try {
						// The exit code is 1 if there are differences, so we strictly capture stdout
						// and ignore the error if it's just exit code 1
						await execAsync(
							`git --no-pager diff --no-index /dev/null "${file}"`,
							{
								cwd: projectRoot,
							},
						);
					} catch (e: any) {
						// git diff --no-index returns exit code 1 when there is a diff
						if (e.stdout) {
							combinedPatch += "\n" + e.stdout;
						}
					}
				}

				return combinedPatch;
			} catch (e) {
				console.error("Failed to get git diff", e);
				throw new Error("Failed to get changes. Is this a git repository?");
			}
		}),

	getFileContent: t.procedure
		.input(z.object({ chatId: z.string(), path: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) throw new Error("Chat not found");

			const projectRoot = session.projectRoot;
			const { join, normalize } = await import("node:path");
			const { readFile } = await import("node:fs/promises");

			// Security check: ensure path is within project root
			const safePath = normalize(input.path).replace(/^(\.\.(\/|\\|$))+/, "");
			const fullPath = join(projectRoot, safePath);

			if (!fullPath.startsWith(projectRoot)) {
				throw new Error("Access denied: Path outside project root");
			}

			try {
				const content = await readFile(fullPath, "utf8");
				return { content };
			} catch (e) {
				console.error(`Failed to read file ${fullPath}`, e);
				throw new Error(`Failed to read file: ${e}`);
			}
		}),

	getSessionState: t.procedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (session) {
				return {
					status: "running" as const,
					modes: session.modes,
					models: session.models,
					commands: session.commands,
				};
			}

			const stored = getSession(input.chatId);
			if (stored) {
				// Return limited info for stopped session
				return {
					status: "stopped" as const,
					modes: null,
					models: null,
					commands: null,
				};
			}

			throw new Error("Chat not found");
		}),

	getSessions: t.procedure.query(() => {
		const storedSessions = loadSessions();
		// We prioritize active sessions from memory (though they should be synced to store)
		// Actually store is the source of truth for list.
		// Active sessions just add "active state" details if needed?
		// For list, store is enough.
		// But let's merge status from memory if disparate?
		// store.ts updates status on exit, so store should be accurate.

		return storedSessions.map((s) => ({
			id: s.id,
			projectRoot: s.projectRoot,
			modeId: s.modeId,
			status: s.status,
		}));
	}),

	// --- Interaction ---

	sendMessage: t.procedure
		.input(
			z.object({
				chatId: z.string(),
				text: z.string(),
				images: z
					.array(
						z.object({
							base64: z.string(),
							mimeType: z.string(),
						}),
					)
					.optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session || !session.sessionId) {
				throw new Error("Chat not found");
			}

			// Send prompt
			console.log(`[tRPC] Sending message to ${input.chatId}`);
			// Note: This promise resolves when the agent *accepts* the prompt,
			// response chunks come via subscription.

			const prompt: any[] = [{ type: "text", text: input.text }];
			if (input.images) {
				prompt.push(
					...input.images.map((img) => ({
						type: "image",
						image: img.base64,
						mimeType: img.mimeType,
					})),
				);
			}

			const res = await session.conn.prompt({
				sessionId: session.sessionId,
				prompt,
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
			if (session.modes) {
				session.modes.currentModeId = input.modeId;
			}
			return { ok: true };
		}),

	cancelPrompt: t.procedure
		.input(z.object({ chatId: z.string() }))
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session || !session.sessionId) {
				throw new Error("Chat not found");
			}

			console.log(`[tRPC] Cancelling prompt for ${input.chatId}`);
			// Call ACP cancel method
			await session.conn.cancel({ sessionId: session.sessionId });

			// Reject all pending permissions with outcome: cancelled
			for (const [reqId, pending] of session.pendingPermissions) {
				pending.resolve({ outcome: { outcome: "cancelled" } });
			}
			session.pendingPermissions.clear();

			return { ok: true };
		}),

	respondToPermissionRequest: t.procedure
		.input(
			z.object({
				chatId: z.string(),
				requestId: z.string(),
				decision: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			const session = chats.get(input.chatId);
			if (!session) {
				throw new Error("Chat not found");
			}

			const pending = session.pendingPermissions.get(input.requestId);
			if (!pending) {
				throw new Error("Permission request not found or already handled");
			}

			console.log(
				`[tRPC] Responding to permission request ${input.requestId}: ${input.decision}`,
			);
			console.log(
				`[tRPC] Available options:`,
				JSON.stringify(pending.options, null, 2),
			);

			let optionId = input.decision === "allow" ? "allow-once" : "reject-once";

			// If specific options were provided by the agent, try to map our generic decision to them
			if (
				pending.options &&
				Array.isArray(pending.options) &&
				pending.options.length > 0
			) {
				// First, check if input.decision matches an optionId exactly
				const exactMatch = pending.options.find(
					(opt: any) =>
						(opt.optionId || opt.id) === input.decision ||
						opt.id === input.decision,
				);

				if (exactMatch) {
					optionId = exactMatch.optionId || exactMatch.id;
					console.log(
						`[tRPC] Exact match mapped ${input.decision} to option ${optionId}`,
					);
				} else {
					// Fallback to heuristics for "allow"/"reject"
					const isAllow = input.decision === "allow";
					// Keywords to look for in option ID or title
					const keywords = isAllow
						? ["allow", "yes", "confirm", "approve"]
						: ["reject", "no", "deny", "cancel", "block"];

					const heuristicMatch = pending.options.find((opt: any) => {
						// Check various common field names for ID and Label
						const id = String(
							opt.optionId || opt.id || opt.kind || "",
						).toLowerCase();
						const label = String(
							opt.name || opt.title || opt.label || "",
						).toLowerCase();

						// If we are allowing, we want "allow" or "yes" or "confirm"
						if (isAllow) {
							// Prioritize exact "allow" if it's an ID
							if (id === "allow" || id === "allow_once") return true;
							return keywords.some((k) => id.includes(k) || label.includes(k));
						}

						// If we are rejecting
						return keywords.some((k) => id.includes(k) || label.includes(k));
					});

					if (heuristicMatch) {
						optionId = heuristicMatch.optionId || heuristicMatch.id;
						console.log(
							`[tRPC] Heuristic mapped ${input.decision} to option ${optionId}`,
						);
					} else {
						console.warn(
							`[tRPC] Could not safely map ${input.decision} to available options:`,
							pending.options,
						);
					}
				}
			}

			pending.resolve({ outcome: { outcome: "selected", optionId } });
			console.log(`[tRPC] Resolved permission with optionId: ${optionId}`);

			session.pendingPermissions.delete(input.requestId);
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
