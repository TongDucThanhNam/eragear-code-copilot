"use client";

import { ChatHeader } from "@/components/chat-ui/chat-header";
import { ChatInput } from "@/components/chat-ui/chat-input";
import {
	ChatMessages,
	type MessageType,
} from "@/components/chat-ui/chat-messages";
import { SettingsDialog } from "@/components/settings-dialog";
import { useSettingsStore } from "@/store/settings-store";
import { createFileRoute } from "@tanstack/react-router";
import { nanoid } from "nanoid";
import { useCallback, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

export const Route = createFileRoute("/")({
	component: Example,
});

function Example() {
	const { setIsOpen, getAgents, activeAgentId, setActiveAgentId } =
		useSettingsStore();

	const agentModels = getAgents();
	const [status, setStatus] = useState<
		"submitted" | "streaming" | "ready" | "error"
	>("ready");
	const [messages, setMessages] = useState<MessageType[]>([]);
	const [chatId, setChatId] = useState<string | null>(null);
	const [connStatus, setConnStatus] = useState<
		"idle" | "connecting" | "connected" | "error"
	>("idle");
	const [availableModes, setAvailableModes] = useState<
		{ id: string; name: string; description?: string }[]
	>([]);
	const [currentModeId, setCurrentModeId] = useState<string | null>(null);
	const [availableModels, setAvailableModels] = useState<
		{ modelId: string; name: string; description?: string }[]
	>([]);
	const [currentModelId, setCurrentModelId] = useState<string | null>(null);
	const [availableCommands, setAvailableCommands] = useState<
		{ name: string; description: string; input?: { hint: string } }[]
	>([]);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const chatIdRef = useRef<string | null>(null);

	// tRPC Mutations
	const createSessionMutation = trpc.createSession.useMutation();
	const sendMessageMutation = trpc.sendMessage.useMutation();
	const stopSessionMutation = trpc.stopSession.useMutation();
	const setModeMutation = trpc.setMode.useMutation();
	const setModelMutation = trpc.setModel.useMutation();

	// tRPC Subscription
	trpc.onSessionEvents.useSubscription(
		{ chatId: chatId || "" },
		{
			enabled: !!chatId,
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
					} else if (u.sessionUpdate === "available_commands_update") {
						console.log(
							"[Client] Commands update:",
							JSON.stringify(u.availableCommands, null, 2),
						);
						setAvailableCommands(u.availableCommands || []);
					}
				} else if (event.type === "current_mode_update") {
					setCurrentModeId(event.modeId);
				} else if (event.type === "error") {
					console.error("tRPC Error Event:", event.error);
					setConnStatus("error");
					setMessages((prev) => [
						...prev,
						{
							key: nanoid(),
							from: "assistant",
							versions: [{ id: nanoid(), content: `❌ Error: ${event.error}` }],
						},
					]);
					// Auto-retry via retryCount? tRPC handles reconnection mostly, but logic here:
					// If error is severe, maybe we should stop?
				} else if (event.type === "heartbeat") {
					// visible heartbeat
					console.log("[Client] Heartbeat", event.ts);
				}
			},
			onError(err) {
				console.error("[Client] Subscription error:", err);
				setConnStatus("error");
				// Trivial auto-reconnect strategy if needed, but wsLink handles it.
				// We can increment retryCount to force re-sub if we want, but usually automatic.
			},
		},
	);

	const handleAgentChunk = useCallback((chunk: string) => {
		setMessages((prev) => {
			const lastMsg = prev[prev.length - 1];
			if (lastMsg && lastMsg.from === "assistant") {
				const currentContent = lastMsg.versions[0].content;
				let newContent = "";
				// Heuristic: If chunk starts with currentContent (and isn't empty), it's likely a snapshot.
				// Otherwise, treat as delta.
				if (
					currentContent &&
					chunk.startsWith(currentContent) &&
					chunk.length > currentContent.length
				) {
					console.log("[Client] Detected snapshot update");
					newContent = chunk;
				} else {
					console.log("[Client] Appending delta");
					newContent = currentContent + chunk;
				}

				console.log("[Client] msg update:", {
					before: currentContent,
					chunk,
					after: newContent,
				});

				const newLastMsg = {
					...lastMsg,
					versions: [{ ...lastMsg.versions[0], content: newContent }],
				};
				return [...prev.slice(0, -1), newLastMsg];
			} else {
				// New assistant message
				const newMsg: MessageType = {
					key: nanoid(),
					from: "assistant",
					versions: [{ id: nanoid(), content: chunk }],
				};
				console.log("[Client] New assistant message:", chunk);
				return [...prev, newMsg];
			}
		});
		setStatus("streaming");
	}, []);

	const handleAgentThought = useCallback((chunk: string) => {
		setMessages((prev) => {
			const lastMsg = prev[prev.length - 1];
			if (lastMsg && lastMsg.from === "assistant") {
				const currentReasoning = lastMsg.reasoning?.content || "";
				// Simply append for now
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
				// New assistant message with thought
				const newMsg: MessageType = {
					key: nanoid(),
					from: "assistant",
					versions: [{ id: nanoid(), content: "" }],
					reasoning: {
						content: chunk,
						duration: 0,
					},
				};
				return [...prev, newMsg];
			}
		});
		setStatus("streaming");
	}, []);

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
				setConnStatus("connected"); // Assumed connected if session created
			} catch (e) {
				console.error("Failed to init chat", e);
				setConnStatus("error");
			}
		},
		[createSessionMutation],
	);

	const handleNewChat = (agentId: string) => {
		setMessages([]);
		setChatId(null);
		chatIdRef.current = null;
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
			setAvailableModes([]);
			setCurrentModeId(null);
			setAvailableModels([]);
			setCurrentModelId(null);
		} catch (e) {
			console.error("Failed to stop chat", e);
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
		async (content: string) => {
			if (!chatId) return;

			const userMessage: MessageType = {
				key: `user-${Date.now()}`,
				from: "user",
				versions: [
					{
						id: `user-${Date.now()}`,
						content,
					},
				],
			};
			setMessages((prev) => [...prev, userMessage]);
			setStatus("streaming");

			// Send to backend
			sendMessageMutation.mutate({ chatId, text: content });

			// Status managed by mutation state if desired, or stream events
			setStatus("ready"); // allow more inputs?
		},
		[chatId, sendMessageMutation],
	);

	const handleSubmit = (message: PromptInputMessage) => {
		const hasText = Boolean(message.text);
		if (!hasText) return;

		setStatus("submitted");
		addUserMessage(message.text);
		// setText(""); // Unused
	};

	// Fetch Project Context
	const { data: projectContext } = trpc.getProjectContext.useQuery(
		{ chatId: chatId || "" },
		{ enabled: !!chatId },
	);

	return (
		<div className="relative flex size-full flex-col divide-y overflow-hidden">
			<ChatHeader
				activeAgentId={activeAgentId}
				connStatus={connStatus}
				agentModels={agentModels}
				onStopChat={handleStopChat}
				onSettingsClick={() => setIsOpen(true)}
				onNewChat={handleNewChat}
			/>

			<ChatMessages messages={messages} />

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
			/>

			<SettingsDialog />
		</div>
	);
}
