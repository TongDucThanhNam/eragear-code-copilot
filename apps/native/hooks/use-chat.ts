import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

// Helper for random IDs
const nanoid = () => Math.random().toString(36).substring(2, 10);

export function useChat() {
	// Select only what we need for the hook's internal logic (subscription key)
	// We do NOT select messages or other volatile state here to prevent re-rendering the hook
	// which tears down and recreates the subscription.
	const activeChatId = useChatStore((s) => s.activeChatId);
	const activeChatIsReadOnly = useChatStore((s) => s.activeChatIsReadOnly);
	const connStatus = useChatStore((s) => s.connStatus);
	const activeAgentId = useSettingsStore((s) => s.activeAgentId);
	const getAgents = useSettingsStore((s) => s.getAgents);

	const utils = trpc.useUtils();
	const lastStreamKindRef = useRef<"user" | "agent" | "other" | null>(null);

	// Mutations
	const createSessionMutation = trpc.createSession.useMutation();
	const stopSessionMutation = trpc.stopSession.useMutation();
	const resumeSessionMutation = trpc.resumeSession.useMutation();
	const sendMessageMutation = trpc.sendMessage.useMutation();
	const setModeMutation = trpc.setMode.useMutation();
	const setModelMutation = trpc.setModel.useMutation();
	const cancelPromptMutation = trpc.cancelPrompt.useMutation();
	const respondToPermissionMutation =
		trpc.respondToPermissionRequest.useMutation();

	// Snapshot state (modes/models/commands) on connect or reconnect
	const sessionStateQuery = trpc.getSessionState.useQuery(
		{ chatId: activeChatId || "" },
		{
			enabled:
				!!activeChatId && !activeChatIsReadOnly && connStatus === "connecting",
			retry: false,
		},
	);

	useEffect(() => {
		const data = sessionStateQuery.data;
		if (!data || connStatus !== "connecting") return;

		const store = useChatStore.getState();
		if (data.status === "stopped") {
			store.setConnStatus("idle");
			return;
		}

		if (data.modes) store.setModes(data.modes);
		if (data.models) store.setModels(data.models);
		if (data.commands) store.setCommands(data.commands);
		store.setConnStatus("connected");
	}, [sessionStateQuery.data, connStatus]);

	// Subscription Handler
	// We use useChatStore.getState() inside to avoid dependencies
	const handleSessionEvent = useCallback((event: any) => {
		const store = useChatStore.getState();

		// Handle explicit connected event from server
		if (event.type === "connected") {
			store.setConnStatus("connected");
			return;
		}

		// Handle replayed user messages from server buffer
		if (event.type === "user_message") {
			store.addMessage({
				id: event.id || nanoid(),
				role: "user",
				parts: [{ type: "text", text: event.text }],
				timestamp: event.timestamp || Date.now(),
			});
			lastStreamKindRef.current = "other";
			return;
		}

		if (event.type === "session_update") {
			const u = event.update;

			if (u.sessionUpdate === "user_message_chunk") {
				let text = "";
				if (typeof u.content === "string") text = u.content;
				else if (typeof u.content === "object")
					text = u.content.text || u.content.delta?.text || "";
				else text = u.text || "";

				if (text) {
					if (lastStreamKindRef.current === "user") {
						store.appendToUserText(text);
					} else {
						store.addMessage({
							id: nanoid(),
							role: "user",
							parts: [{ type: "text", text }],
							timestamp: Date.now(),
						});
					}
					lastStreamKindRef.current = "user";
				}
				return;
			}

			if (u.sessionUpdate === "agent_message_chunk") {
				let text = "";
				if (typeof u.content === "string") text = u.content;
				else if (typeof u.content === "object")
					text = u.content.text || u.content.delta?.text || "";
				else text = u.text || "";

				if (text) {
					store.appendToText(text);
					lastStreamKindRef.current = "agent";
				}
			} else if (u.sessionUpdate === "agent_thought_chunk") {
				let text = "";
				if (typeof u.content === "string") text = u.content;
				else if (typeof u.content === "object")
					text = u.content.text || u.content.delta?.text || "";
				else text = u.text || "";

				console.log("[agent_thought_chunk] extracted text:", JSON.stringify(text));
				console.log("[agent_thought_chunk] messages count before:", store.messages.length);

				if (text) {
					store.appendToReasoning(text);
					lastStreamKindRef.current = "agent";
					console.log("[agent_thought_chunk] messages count after:", store.messages.length);
				} else {
					console.log("[agent_thought_chunk] empty text, u:", JSON.stringify(u));
				}
			} else if (u.sessionUpdate === "tool_call") {
				store.flushPending();
				lastStreamKindRef.current = "other";
				// Add tool call to message
				const lastMsg = store.messages.slice(-1)[0];
				if (lastMsg?.role === "assistant") {
					const newParts = [
						...lastMsg.parts,
						{
							type: "tool_call" as const,
							toolCallId: u.toolCallId,
							name: u.title || u.kind || "Tool",
							args: u.rawInput,
						},
					];
					store.updateLastAssistantMessage(newParts);
				}
			} else if (u.sessionUpdate === "tool_call_update") {
				// Handle status updates or result
				const lastMsg = store.messages.slice(-1)[0];
				if (lastMsg?.role === "assistant") {
					const parts = [...lastMsg.parts];
					const lastPart = parts[parts.length - 1];

					// If last part is a tool_call with matching toolCallId, update it
					if (
						lastPart?.type === "tool_call" &&
						lastPart.toolCallId === u.toolCallId
					) {
						// If there's content/output, append as tool_result
						if (u.content && u.status === "completed") {
							parts.push({
								type: "tool_result" as const,
								toolCallId: u.toolCallId,
								status: u.status,
								output: u.rawOutput || u.content,
							});
							store.updateLastAssistantMessage(parts);
						}
					}
				}
			} else if (u.sessionUpdate === "plan") {
				store.flushPending();
				// Add or update plan
				const entries = u.entries;
				const lastMsg = store.messages.slice(-1)[0];
				if (lastMsg?.role === "assistant") {
					// Check if last part is plan
					const lastPart = lastMsg.parts[lastMsg.parts.length - 1];
					if (lastPart?.type === "plan") {
						const newParts = [...lastMsg.parts];
						newParts[newParts.length - 1] = {
							type: "plan",
							items: entries.map((e: any) => ({
								content: e.title || e.text,
								status: e.status,
							})),
						};
						store.updateLastAssistantMessage(newParts);
					} else {
						store.updateLastAssistantMessage([
							...lastMsg.parts,
							{
								type: "plan",
								items: entries.map((e: any) => ({
									content: e.title || e.text,
									status: e.status,
								})),
							},
						]);
					}
				} else {
					store.addMessage({
						id: nanoid(),
						role: "assistant",
						parts: [
							{
								type: "plan",
								items: entries.map((e: any) => ({
									content: e.title || e.text,
									status: e.status,
								})),
							},
						],
						timestamp: Date.now(),
					});
				}
			} else if (u.sessionUpdate === "available_commands_update") {
				store.setCommands(u.availableCommands || []);
			}
		} else if (event.type === "current_mode_update") {
			const modes = store.modes;
			if (modes) {
				store.setModes({ ...modes, currentModeId: event.modeId });
			}
		} else if (event.type === "request_permission") {
			store.setPendingPermission({
				requestId: event.requestId,
				toolCall: event.toolCall,
				options: event.options,
			});
		} else if (event.type === "terminal_output") {
			const { terminalId, data } = event;
			if (terminalId && data) {
				store.appendTerminalOutput(terminalId, data);
			}
		} else if (event.type === "error") {
			store.setError(event.error);
		}
	}, []);

	// Check if this chat has already failed (prevents infinite loop)
	const isChatFailed = useChatStore((s) => s.isChatFailed);
	const shouldSubscribe =
		!!activeChatId &&
		!activeChatIsReadOnly &&
		!isChatFailed(activeChatId) &&
		connStatus === "connected";

	// Subscription
	trpc.onSessionEvents.useSubscription(
		{ chatId: activeChatId || "" },
		{
			enabled: shouldSubscribe,
			onData: handleSessionEvent,
			onError(err) {
				console.error("Subscription error:", err);
				const store = useChatStore.getState();
				const message =
					typeof err?.message === "string" ? err.message : "Subscription error";

				if (message.includes("Chat not found") && activeChatId) {
					// Mark this chat as failed to prevent infinite re-subscription
					store.markChatFailed(activeChatId);
					store.setActiveChatId(null);
					store.setConnStatus("idle");
					store.setError(
						"Chat not found. The session may have expired. Please start a new session.",
					);
					return;
				}

				store.setConnStatus("error");
				store.setError(message);
			},
		},
	);

	const createSession = async () => {
		try {
			const agentId = activeAgentId;
			const agent = getAgents().find((a) => a.id === agentId);
			const store = useChatStore.getState();

			if (!agent) {
				store.setError("Please configure an ACP agent first.");
				store.setConnStatus("idle");
				return;
			}

			store.setConnStatus("connecting");
			const res = await createSessionMutation.mutateAsync({
				projectRoot: ".",
				command: agent.command,
				args: agent.args,
				env: agent.env,
				cwd: agent.cwd,
			});

			store.setActiveChatId(res.chatId);
			if (res.modes) store.setModes(res.modes);
			if (res.models) store.setModels(res.models);
			store.setConnStatus("connected");
		} catch (e: any) {
			useChatStore.getState().setError(e.message);
			useChatStore.getState().setConnStatus("error");
		}
	};

	const sendMessage = async (text: string) => {
		if (!activeChatId) return;
		const store = useChatStore.getState();

		// Note: We don't add message here. Server will broadcast user_message event
		// which will be received via subscription and added to store.
		// This ensures consistency between live and replayed messages.

		try {
			await sendMessageMutation.mutateAsync({ chatId: activeChatId, text });
		} catch (e: any) {
			store.setError(e.message);
		}
	};

	const setMode = async (modeId: string) => {
		if (!activeChatId) return;
		const store = useChatStore.getState();
		try {
			await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
			if (store.modes) {
				store.setModes({ ...store.modes, currentModeId: modeId });
			}
		} catch (e: any) {
			store.setError(e.message);
		}
	};

	const setModel = async (modelId: string) => {
		if (!activeChatId) return;
		const store = useChatStore.getState();
		try {
			await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
			if (store.models) {
				store.setModels({ ...store.models, currentModelId: modelId });
			}
		} catch (e: any) {
			store.setError(e.message);
		}
	};

	const respondToPermission = async (requestId: string, decision: string) => {
		if (!activeChatId) return;
		const store = useChatStore.getState();
		try {
			await respondToPermissionMutation.mutateAsync({
				chatId: activeChatId,
				requestId,
				decision,
			});
			store.setPendingPermission(null);
		} catch (e: any) {
			store.setError(e.message);
		}
	};

	const stopSession = async () => {
		if (!activeChatId) return;
		await stopSessionMutation.mutateAsync({ chatId: activeChatId });
		useChatStore.getState().setConnStatus("idle");
	};

	const resumeSession = async (chatId: string) => {
		const store = useChatStore.getState();
		try {
			const res = await resumeSessionMutation.mutateAsync({ chatId });
			return res;
		} catch (e: any) {
			store.setError(e.message);
			store.setConnStatus("error");
			throw e;
		}
	};

	return {
		createSession,
		sendMessage,
		setMode,
		setModel,
		respondToPermission,
		stopSession,
		resumeSession,
		isCreating: createSessionMutation.isPending,
		isResuming: resumeSessionMutation.isPending,
		isSending: sendMessageMutation.isPending,
	};
}
