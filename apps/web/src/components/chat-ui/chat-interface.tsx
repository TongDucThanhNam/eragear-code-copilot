import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import {
	ChatMessages,
	type MessageType,
	type ToolPart,
} from "@/components/chat-ui/chat-messages";
import { SettingsDialog } from "@/components/settings-dialog";
import { trpc } from "@/lib/trpc";
import { useFileStore } from "@/store/file-store";
import { useSettingsStore } from "@/store/settings-store";

const convertFileToBase64 = (file: File): Promise<string> => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			// Remove data URL prefix
			const base64 = result.split(",")[1];
			resolve(base64);
		};
		reader.onerror = (error) => reject(error);
	});
};

interface ChatInterfaceProps {
	initialChatId?: string | null;
	onChatIdChange?: (chatId: string | null) => void;
}

export function ChatInterface({
	initialChatId,
	onChatIdChange,
}: ChatInterfaceProps) {
	const { setIsOpen, getAgents, activeAgentId, setActiveAgentId } =
		useSettingsStore();

	const agentModels = getAgents();
	const utils = trpc.useUtils();

	// UI State ( không cần cache )
	const [status, setStatus] = useState<
		"submitted" | "streaming" | "ready" | "error"
	>("ready");
	const [chatId, setChatId] = useState<string | null>(initialChatId || null);
	const [connStatus, setConnStatus] = useState<
		"idle" | "connecting" | "connected" | "error"
	>(initialChatId ? "connecting" : "idle");
	const [currentModeId, setCurrentModeId] = useState<string | null>(null);
	const [currentModelId, setCurrentModelId] = useState<string | null>(null);

	// Session state ( có thể cache nhưng đơn giản hơn với local state )
	const [availableModes, setAvailableModes] = useState<
		{ id: string; name: string; description?: string }[]
	>([]);
	const [availableModels, setAvailableModels] = useState<
		{ modelId: string; name: string; description?: string }[]
	>([]);
	const [availableCommands, setAvailableCommands] = useState<
		{ name: string; description: string; input?: { hint: string } }[]
	>([]);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const chatIdRef = useRef<string | null>(initialChatId || null);

	// Messages from Query Cache
	// Note: We use local state for messages instead of query cache because
	// the subscription already replays the messageBuffer on connect.
	// The buffer contains raw events that need to be transformed, which happens
	// naturally via the event handlers.
	const [messages, setMessages] = useState<MessageType[]>([]);

	// Helper to update messages in state
	const updateMessagesState = useCallback(
		(updater: (old: MessageType[]) => MessageType[]) => {
			setMessages((prev) => updater(prev));
		},
		[],
	);

	// Sync prop changes (e.g. from URL navigation) to internal state
	useEffect(() => {
		if (initialChatId && initialChatId !== chatId) {
			console.log(
				"[ChatInterface] Reconnecting to chat from prop:",
				initialChatId,
			);
			setChatId(initialChatId);
			chatIdRef.current = initialChatId;
			setConnStatus("connecting");
		} else if (!initialChatId && chatId) {
			// If prop cleared but we have local state, should we clear?
			// Generally yes if logic is driven by URL.
		}
	}, [initialChatId, chatId]);

	// tRPC Mutations
	const createSessionMutation = trpc.createSession.useMutation();
	const sendMessageMutation = trpc.sendMessage.useMutation();
	const stopSessionMutation = trpc.stopSession.useMutation();
	const setModeMutation = trpc.setMode.useMutation();
	const setModelMutation = trpc.setModel.useMutation();
	const resumeSessionMutation = trpc.resumeSession.useMutation();
	const cancelPromptMutation = trpc.cancelPrompt.useMutation();
	const permissionResponseMutation =
		trpc.respondToPermissionRequest.useMutation();

	// Fetch Session State (for reconnection)
	const { data: sessionState } = trpc.getSessionState.useQuery(
		{ chatId: chatId || "" },
		{
			enabled: !!chatId && connStatus === "connecting",
			retry: false,
		},
	);

	// Apply Session State
	useEffect(() => {
		if (sessionState && connStatus === "connecting") {
			console.log("[Client] Session state restored:", sessionState);

			if (sessionState.status === "stopped") {
				console.log("[Client] Session is stopped");
				setConnStatus("idle");
				return;
			}

			if (sessionState.modes) {
				setAvailableModes(
					(sessionState.modes.availableModes || []).map((m) => ({
						...m,
						description: m.description || undefined,
					})),
				);
				setCurrentModeId(sessionState.modes.currentModeId || null);
			}
			if (sessionState.models) {
				setAvailableModels(
					(sessionState.models.availableModels || []).map((m) => ({
						modelId: m.modelId,
						name: m.name,
						description: m.description || undefined,
					})),
				);
				setCurrentModelId(sessionState.models.currentModelId || null);
			}
			if (sessionState.commands) {
				setAvailableCommands(sessionState.commands);
			}
			setConnStatus("connected");
		}
	}, [sessionState, connStatus]);

	// tRPC Subscription
	trpc.onSessionEvents.useSubscription(
		{ chatId: chatId || "" },
		{
			enabled: !!chatId && connStatus === "connected",
			onData(event) {
				console.log("[Client] tRPC Event:", event);
				if (event.type === "session_update") {
					const u = event.update as any;
					console.log(
						"[Client] Session Update Detail:",
						JSON.stringify(u, null, 2),
					);

					if (u.sessionUpdate === "agent_message_chunk") {
						let text = "";
						if (typeof u.content === "string") {
							text = u.content;
						} else if (typeof u.content === "object" && u.content) {
							text =
								u.content.text ||
								u.content.delta?.text ||
								u.content.value ||
								"";
						} else {
							text = u.text || "";
						}

						if (text) {
							handleAgentChunk(text);
						} else {
							console.warn("[Client] Could not extract text from chunk:", u);
						}
					} else if (u.sessionUpdate === "agent_thought_chunk") {
						let text = "";
						if (typeof u.content === "string") {
							text = u.content;
						} else if (typeof u.content === "object" && u.content) {
							text =
								u.content.text ||
								u.content.delta?.text ||
								u.content.value ||
								"";
						} else {
							text = u.text || "";
						}

						if (text) {
							handleAgentThought(text);
						} else {
							console.warn("[Client] Could not extract thought from chunk:", u);
						}
					} else if (u.sessionUpdate === "tool_call") {
						handleAgentToolCall(u);
					} else if (u.sessionUpdate === "tool_call_update") {
						handleAgentToolCallUpdate(u);
					} else if (u.sessionUpdate === "available_commands_update") {
						console.log(
							"[Client] Commands update:",
							JSON.stringify(u.availableCommands, null, 2),
						);
						setAvailableCommands(u.availableCommands || []);
					} else if (u.sessionUpdate === "plan") {
						handleAgentPlan(u.entries);
					}
				} else if (event.type === "current_mode_update") {
					setCurrentModeId(event.modeId);
				} else if (event.type === "request_permission") {
					console.log("[Client] Permission Request:", event);
					handlePermissionRequest(
						event.requestId,
						event.toolCall,
						(event as any).options,
					);
				} else if (event.type === "error") {
					console.error("tRPC Error Event:", event.error);
					setConnStatus("error");
					// Add error message to cache
					updateMessagesState((prev) => [
						...prev,
						{
							key: nanoid(),
							from: "assistant" as const,
							versions: [
								{
									id: nanoid(),
									parts: [{ type: "text", content: `❌ Error: ${event.error}` }],
								},
							],
						},
					]);
				} else if (event.type === "heartbeat") {
					console.log("[Client] Heartbeat", event.ts);
				}
			},
			onError(err) {
				console.error("[Client] Subscription error:", err);
				setConnStatus("error");
			},
		},
	);

	// Handler functions using cache
	const handleAgentToolCall = useCallback(
		(tool: any) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const newTool: ToolPart = {
						type: "tool",
						toolCallId: tool.toolCallId,
						name: tool.title || tool.kind || "Tool",
						description: tool.kind,
						status: (tool.status || "pending") as
							| "pending"
							| "approval-requested"
							| "running"
							| "completed"
							| "error",
						parameters: tool.rawInput || {},
						result: undefined,
						error: undefined,
					};

					const versions = [...lastMsg.versions];
					const lastVersion = { ...versions[versions.length - 1] };
					lastVersion.parts = [...lastVersion.parts, newTool];
					versions[versions.length - 1] = lastVersion;

					return [...prev.slice(0, -1), { ...lastMsg, versions }];
				}
				return prev;
			});
		},
		[updateMessagesState],
	);

	const handleAgentToolCallUpdate = useCallback(
		(update: any) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const versions = [...lastMsg.versions];
					const lastVersion = { ...versions[versions.length - 1] };
					const parts = [...lastVersion.parts];

					// Find the tool in parts
					const partIndex = parts.findIndex(
						(p) => p.type === "tool" && p.toolCallId === update.toolCallId,
					);

					if (partIndex !== -1) {
						const tool = { ...(parts[partIndex] as ToolPart) };

						// Update status
						if (update.status) {
							tool.status = update.status as
								| "pending"
								| "approval-requested"
								| "running"
								| "completed"
								| "error";
						}

						// Update content/result
						if (update.content && Array.isArray(update.content)) {
							const textContent = update.content
								.map((c: any) => c.content?.text || "")
								.join("\n");
							tool.result = textContent;
						}

						parts[partIndex] = tool;
						lastVersion.parts = parts;
						versions[versions.length - 1] = lastVersion;
						return [...prev.slice(0, -1), { ...lastMsg, versions }];
					}
				}
				return prev;
			});
		},
		[updateMessagesState],
	);

	const handleAgentPlan = useCallback(
		(entries: any[]) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const versions = [...lastMsg.versions];
					const lastVersion = { ...versions[versions.length - 1] };
					const parts = [...lastVersion.parts];

					// Check if last part is already a plan, if so update it, otherwise push new
					const lastPart = parts[parts.length - 1];
					if (lastPart && lastPart.type === "plan") {
						parts[parts.length - 1] = { ...lastPart, entries };
					} else {
						parts.push({ type: "plan", entries });
					}

					lastVersion.parts = parts;
					versions[versions.length - 1] = lastVersion;

					return [...prev.slice(0, -1), { ...lastMsg, versions }];
				} else {
					// Should probably start a new message if last wasn't assistant,
					// but usually plan comes after some text or as first thing.
					// If no message, create one.
					const newMsg: MessageType = {
						key: nanoid(),
						from: "assistant",
						versions: [
							{
								id: nanoid(),
								parts: [{ type: "plan", entries }],
							},
						],
					};
					return [...prev, newMsg];
				}
			});
		},
		[updateMessagesState],
	);

	const handlePermissionRequest = useCallback(
		(requestId: string, toolCall: any, options?: unknown[]) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const versions = [...lastMsg.versions];
					const lastVersion = { ...versions[versions.length - 1] };
					const parts = [...lastVersion.parts];

					const targetId = (toolCall as any).toolCallId;
					const partIndex = parts.findIndex(
						(p) => p.type === "tool" && p.toolCallId === targetId,
					);

					if (partIndex !== -1) {
						parts[partIndex] = {
							...parts[partIndex],
							status: "approval-requested" as const,
							requestId: requestId,
							options: options,
						} as ToolPart;

						lastVersion.parts = parts;
						versions[versions.length - 1] = lastVersion;
						return [...prev.slice(0, -1), { ...lastMsg, versions }];
					}
				}
				return prev;
			});
		},
		[updateMessagesState],
	);

	const handleApproveTool = useCallback(
		(requestId: string, decision: string = "allow") => {
			if (!chatId) return;
			permissionResponseMutation.mutate({
				chatId,
				requestId,
				decision,
			});
		},
		[chatId, permissionResponseMutation],
	);

	const handleRejectTool = useCallback(
		(requestId: string, decision: string = "reject") => {
			if (!chatId) return;
			permissionResponseMutation.mutate({
				chatId,
				requestId,
				decision,
			});
		},
		[chatId, permissionResponseMutation],
	);

	const handleAgentChunk = useCallback(
		(chunk: string) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const versions = [...lastMsg.versions];
					const lastVersion = { ...versions[versions.length - 1] };
					const parts = [...lastVersion.parts];

					const lastPart = parts[parts.length - 1];
					if (lastPart && lastPart.type === "text") {
						// Append to last text part
						const newContent = lastPart.content + chunk; // Simple append for now
						parts[parts.length - 1] = { ...lastPart, content: newContent };
					} else {
						// New text part
						parts.push({ type: "text", content: chunk });
					}

					lastVersion.parts = parts;
					versions[versions.length - 1] = lastVersion;

					return [...prev.slice(0, -1), { ...lastMsg, versions }];
				} else {
					const newMsg: MessageType = {
						key: nanoid(),
						from: "assistant",
						versions: [
							{
								id: nanoid(),
								parts: [{ type: "text", content: chunk }],
							},
						],
					};
					return [...prev, newMsg];
				}
			});
			setStatus("streaming");
		},
		[updateMessagesState],
	);

	const handleAgentThought = useCallback(
		(chunk: string) => {
			updateMessagesState((prev) => {
				const lastMsg = prev[prev.length - 1];
				if (lastMsg && lastMsg.from === "assistant") {
					const currentReasoning = lastMsg.reasoning?.content || "";
					const newReasoning = currentReasoning + chunk;

					const newLastMsg = {
						...lastMsg,
						reasoning: {
							content: newReasoning,
							duration: lastMsg.reasoning?.duration || 0,
						},
					};
					return [...prev.slice(0, -1), newLastMsg];
				} else {
					const newMsg: MessageType = {
						key: nanoid(),
						from: "assistant",
						versions: [
							{
								id: nanoid(),
								parts: [], // Empty parts, reasoning is separate property
							},
						],
						reasoning: {
							content: chunk,
							duration: 0,
						},
					};
					return [...prev, newMsg];
				}
			});
			setStatus("streaming");
		},
		[updateMessagesState],
	);

	// Initialize chat session
	const initChat = useCallback(
		async (agentId?: string) => {
			const targetId = agentId || useSettingsStore.getState().activeAgentId;
			const agent = useSettingsStore
				.getState()
				.getAgents()
				.find((a) => a.id === targetId);

			if (!agent) {
				console.warn("No active agent selected");
				setConnStatus("idle");
				return;
			}

			setConnStatus("connecting");
			try {
				const data = await createSessionMutation.mutateAsync({
					projectRoot: ".",
					command: agent?.command,
					args: agent?.args,
					env: agent?.env,
					cwd: agent?.cwd,
				});

				setChatId(data.chatId);
				chatIdRef.current = data.chatId;

				// Notify parent/URL about change
				if (onChatIdChange) {
					onChatIdChange(data.chatId);
				}

				if (data.modes) {
					setAvailableModes(
						(data.modes.availableModes || []).map((m) => ({
							...m,
							description: m.description || undefined,
						})),
					);
					setCurrentModeId(data.modes.currentModeId || null);
				}
				if (data.models) {
					setAvailableModels(
						(data.models.availableModels || []).map((m) => ({
							modelId: m.modelId,
							name: m.name,
							description: m.description || undefined,
						})),
					);
					setCurrentModelId(data.models.currentModelId || null);
				}
				setConnStatus("connected");
			} catch (e) {
				console.error("Failed to init chat", e);
				setConnStatus("error");
			}
		},
		[createSessionMutation, onChatIdChange],
	);

	const handleNewChat = (agentId: string) => {
		// Clear messages state
		setMessages([]);
		setChatId(null);
		chatIdRef.current = null;

		// Notify parent to clear
		if (onChatIdChange) {
			onChatIdChange(null);
		}

		setActiveAgentId(agentId);
		initChat(agentId);
	};

	const handleStopChat = async () => {
		const targetChatId = chatIdRef.current;
		if (!targetChatId) return;
		try {
			await stopSessionMutation.mutateAsync({ chatId: targetChatId });
			setConnStatus("idle");
			setChatId(null);
			chatIdRef.current = null;

			// Notify parent to clear
			if (onChatIdChange) {
				onChatIdChange(null);
			}

			setAvailableModes([]);
			setCurrentModeId(null);
			setAvailableModels([]);
			setCurrentModelId(null);
		} catch (e) {
			console.error("Failed to stop chat", e);
		}
	};

	const handleCancel = async () => {
		if (!chatId) return;
		try {
			await cancelPromptMutation.mutateAsync({ chatId });
		} catch (e) {
			console.error("Failed to cancel prompt", e);
		}
	};

	const handleResume = async () => {
		if (!chatId) return;
		try {
			// Do NOT set "connecting" yet. Wait for mutation.
			// The UI will show "Resuming..." via isResuming state (derived from mutation)
			await resumeSessionMutation.mutateAsync({ chatId });

			// NOW invalidate buffer to ensure we get fresh status
			await utils.getSessionState.invalidate({ chatId });

			// Finally enable the connection check
			setConnStatus("connecting");
		} catch (e) {
			console.error("Failed to resume chat", e);
			setConnStatus("error");
		}
	};

	const handleSetMode = async (modeId: string) => {
		if (!chatId) return;
		try {
			await setModeMutation.mutateAsync({ chatId, modeId });
			setCurrentModeId(modeId);
		} catch (e) {
			console.error("Failed to set mode", e);
		}
	};

	const handleSetModel = async (modelId: string) => {
		if (!chatId) return;
		try {
			await setModelMutation.mutateAsync({ chatId, modelId });
			setCurrentModelId(modelId);
		} catch (e) {
			console.error("Failed to set model", e);
		}
	};

	const addUserMessage = useCallback(
		async (
			content: string,
			images?: { base64: string; mimeType: string }[],
		) => {
			if (!chatId) return;

			const userMessage: MessageType = {
				key: `user-${Date.now()}`,
				from: "user",
				versions: [
					{
						id: `user-${Date.now()}`,
						parts: [
							{
								type: "text",
								content:
									content +
									(images?.length
										? `\n\n[Attached ${images.length} image(s)]`
										: ""),
							},
						],
					},
				],
			};
			updateMessagesState((prev) => [...prev, userMessage]);
			setStatus("streaming");

			try {
				const res = await sendMessageMutation.mutateAsync({
					chatId,
					text: content,
					images,
				});

				if (res.stopReason === "cancelled") {
					updateMessagesState((prev) => [
						...prev,
						{
							key: nanoid(),
							from: "assistant",
							versions: [
								{
									id: nanoid(),
									parts: [{ type: "text", content: "🚫 Generation cancelled." }],
								},
							],
						},
					]);
				} else if (res.stopReason === "max_tokens") {
					updateMessagesState((prev) => [
						...prev,
						{
							key: nanoid(),
							from: "assistant",
							versions: [
								{
									id: nanoid(),
									parts: [{ type: "text", content: "⚠️ Max tokens reached." }],
								},
							],
						},
					]);
				}
			} catch (e) {
				console.error("Failed to send message", e);
				setConnStatus("error");
			} finally {
				setStatus("ready");
			}
		},
		[chatId, sendMessageMutation, updateMessagesState],
	);

	const handleSubmit = async (message: PromptInputMessage) => {
		const hasText = Boolean(message.text);
		const hasFiles = message.files.length > 0;
		if (!hasText && !hasFiles) return;

		setStatus("submitted");

		const images: { base64: string; mimeType: string }[] = [];
		for (const filePart of message.files) {
			if (filePart.file && filePart.file.type.startsWith("image/")) {
				try {
					const base64 = await convertFileToBase64(filePart.file);
					images.push({
						base64,
						mimeType: filePart.file.type,
					});
				} catch (e) {
					console.error("Failed to convert file to base64", e);
				}
			}
		}

		addUserMessage(message.text, images.length > 0 ? images : undefined);
	};

	// Fetch Project Context
	const { data: projectContext } = trpc.getProjectContext.useQuery(
		{ chatId: chatId || "" },
		{ enabled: !!chatId },
	);

	const setFiles = useFileStore((state) => state.setFiles);
	useEffect(() => {
		if (projectContext?.files) {
			setFiles(projectContext.files);
		}
	}, [projectContext, setFiles]);

	return (
		<div className="relative flex size-full flex-col divide-y overflow-hidden">
			<ChatHeader
				activeAgentId={activeAgentId}
				connStatus={connStatus}
				agentModels={agentModels}
				onStopChat={handleStopChat}
				onResumeChat={handleResume}
				isResuming={resumeSessionMutation.isPending}
				onSettingsClick={() => setIsOpen(true)}
				onNewChat={handleNewChat}
			/>

			<ChatMessages
				messages={messages}
				onApprove={handleApproveTool}
				onReject={handleRejectTool}
			/>

			<ChatInput
				textareaRef={textareaRef}
				status={status}
				connStatus={connStatus}
				availableModes={availableModes}
				currentModeId={currentModeId}
				onModeChange={handleSetMode}
				availableModels={availableModels}
				currentModelId={currentModelId}
				onModelChange={handleSetModel}
				onSubmit={handleSubmit}
				activeTabs={projectContext?.activeTabs}
				projectRules={projectContext?.projectRules}
				availableCommands={availableCommands}
				onCancel={handleCancel}
			/>

			<SettingsDialog />
		</div>
	);
}
