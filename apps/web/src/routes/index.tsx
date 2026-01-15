"use client";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageBranch,
	MessageBranchContent,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputProvider,
	PromptInputSelect,
	PromptInputSelectContent,
	PromptInputSelectItem,
	PromptInputSelectTrigger,
	PromptInputSelectValue,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsDialog } from "@/components/settings-dialog";
import { useSettingsStore } from "@/store/settings-store";
import { createFileRoute } from "@tanstack/react-router";
import type { ToolUIPart } from "ai";
import {
	ChevronDown,
	LogOut,
	Radio,
	RefreshCw,
	Settings2Icon,
	CheckIcon,
} from "lucide-react";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../lib/trpc";

export const Route = createFileRoute("/")({
	component: Example,
});

type MessageType = {
	key: string;
	from: "user" | "assistant";
	sources?: { href: string; title: string }[];
	versions: {
		id: string;
		content: string;
	}[];
	reasoning?: {
		content: string;
		duration: number;
	};
	tools?: {
		name: string;
		description: string;
		status: ToolUIPart["state"];
		parameters: Record<string, unknown>;
		result: string | undefined;
		error: string | undefined;
	}[];
};

function Example() {
	const { setIsOpen, getAgents, activeAgentId, setActiveAgentId } =
		useSettingsStore();

	const agentModels = getAgents();
	// const [text, setText] = useState<string>(""); // Unused
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
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	// const [retryCount, setRetryCount] = useState(0); // Unused in tRPC version for now
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
					setAvailableModes(data.modes.availableModes || []);
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
		setText("");
	};

	const getProviderFromModelId = (modelId: string) => {
		if (modelId.startsWith("anthropic")) return "anthropic";
		if (modelId.startsWith("google") || modelId.startsWith("gemini"))
			return "google";
		if (modelId.startsWith("openai") || modelId.startsWith("gpt"))
			return "openai";
		if (modelId.startsWith("deepseek")) return "deepseek";
		if (modelId.startsWith("mistral")) return "mistral";
		if (modelId.startsWith("meta") || modelId.startsWith("llama"))
			return "meta";
		return "opencode"; // default
	};

	const groupedModels = availableModels.reduce(
		(acc, model) => {
			const provider = getProviderFromModelId(model.modelId);
			if (!acc[provider]) acc[provider] = [];
			acc[provider].push(model);
			return acc;
		},
		{} as Record<
			string,
			{ modelId: string; name: string; description?: string }[]
		>,
	);

	return (
		<div className="relative flex size-full flex-col divide-y overflow-hidden">
			{/* Chat Header */}
			<div className="flex items-center justify-between px-4 py-2 bg-background/50 backdrop-blur-sm z-10 shrink-0">
				<div className="flex items-center gap-3">
					<div className="flex flex-col">
						<span className="text-sm font-semibold leading-none">
							{activeAgentId || "No Agent"}
						</span>
						<div className="flex items-center gap-1.5 mt-1">
							<Radio
								className={`h-3 w-3 ${
									connStatus === "connected"
										? "text-green-500 animate-pulse"
										: connStatus === "connecting"
											? "text-amber-500 animate-pulse"
											: connStatus === "error"
												? "text-red-500"
												: "text-muted-foreground"
								}`}
							/>
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
								{connStatus}
							</span>
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2">
					{connStatus === "connected" && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 text-muted-foreground hover:text-destructive transition-colors"
							onClick={handleStopChat}
						>
							<LogOut className="h-3.5 w-3.5" />
							Disconnect
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
						onClick={() => setIsOpen(true)}
					>
						<Settings2Icon className="h-3.5 w-3.5" />
						Settings
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="outline" size="sm" className="h-8 gap-1.5">
									<RefreshCw className="h-3.5 w-3.5" />
									New Chat
									<ChevronDown className="h-3.5 w-3.5 opacity-50" />
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="w-[200px]">
							{agentModels.map((agent) => (
								<DropdownMenuItem
									key={agent.id}
									onClick={() => handleNewChat(agent.id)}
									className="flex flex-col items-start gap-0.5"
								>
									<span className="font-medium text-sm">{agent.name}</span>
									<span className="text-[10px] text-muted-foreground uppercase tracking-widest">
										{agent.type} • {agent.command}
									</span>
								</DropdownMenuItem>
							))}
							{agentModels.length === 0 && (
								<DropdownMenuItem disabled>
									No agents configured
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="flex-1">
				<Conversation>
					<ConversationContent>
						{messages.map(({ versions, ...message }) => (
							<MessageBranch defaultBranch={0} key={message.key}>
								<MessageBranchContent>
									{versions.map((version) => (
										<Message
											from={message.from}
											key={`${message.key}-${version.id}`}
										>
											<div>
												{message.reasoning && (
													<Reasoning duration={message.reasoning.duration}>
														<ReasoningTrigger />
														<ReasoningContent>
															{message.reasoning.content}
														</ReasoningContent>
													</Reasoning>
												)}
												<MessageContent>
													<MessageResponse>{version.content}</MessageResponse>
												</MessageContent>
											</div>
										</Message>
									))}
								</MessageBranchContent>
							</MessageBranch>
						))}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</div>

			<div className="w-full px-4 pb-4">
				<PromptInputProvider>
					<PromptInput globalDrop multiple onSubmit={handleSubmit}>
						<PromptInputAttachments>
							{(attachment) => <PromptInputAttachment data={attachment} />}
						</PromptInputAttachments>
						<PromptInputBody>
							<PromptInputTextarea ref={textareaRef} />
						</PromptInputBody>
						<PromptInputFooter>
							<PromptInputTools>
								<PromptInputActionMenu>
									<PromptInputActionMenuTrigger />
									<PromptInputActionMenuContent>
										<PromptInputActionAddAttachments />
									</PromptInputActionMenuContent>
								</PromptInputActionMenu>

								{connStatus === "connected" && availableModes.length > 0 && (
									<PromptInputSelect
										value={currentModeId || ""}
										onValueChange={(val) => handleSetMode(val as string)}
									>
										<PromptInputSelectTrigger className="h-8 py-0 px-2 min-w-[70px]">
											<PromptInputSelectValue />
										</PromptInputSelectTrigger>
										<PromptInputSelectContent>
											{availableModes.map((mode) => (
												<PromptInputSelectItem key={mode.id} value={mode.id}>
													{mode.name}
												</PromptInputSelectItem>
											))}
										</PromptInputSelectContent>
									</PromptInputSelect>
								)}

								{connStatus === "connected" && availableModels.length > 0 && (
									<ModelSelector
										open={modelSelectorOpen}
										onOpenChange={setModelSelectorOpen}
									>
										<ModelSelectorTrigger
											render={
												<PromptInputButton className="gap-1.5 px-2 min-w-[100px]">
													<ModelSelectorLogo
														provider={getProviderFromModelId(
															currentModelId || "",
														)}
													/>
													<ModelSelectorName>
														{availableModels.find(
															(m) => m.modelId === currentModelId,
														)?.name || "Select Model"}
													</ModelSelectorName>
													<ChevronDown className="h-3.5 w-3.5 opacity-50" />
												</PromptInputButton>
											}
										/>
										<ModelSelectorContent title="Select Assistant Model">
											<ModelSelectorInput placeholder="Search models..." />
											<ModelSelectorList>
												<ModelSelectorEmpty>
													No models found.
												</ModelSelectorEmpty>
												{Object.entries(groupedModels).map(
													([provider, models]) => (
														<ModelSelectorGroup
															key={provider}
															heading={provider.toUpperCase()}
														>
															{models.map((m) => (
																<ModelSelectorItem
																	key={m.modelId}
																	onSelect={() => {
																		handleSetModel(m.modelId);
																		setModelSelectorOpen(false);
																	}}
																	value={m.modelId}
																	className="gap-2"
																>
																	<ModelSelectorLogo
																		provider={getProviderFromModelId(m.modelId)}
																	/>
																	<ModelSelectorName>
																		{m.name}
																	</ModelSelectorName>
																	{currentModelId === m.modelId ? (
																		<CheckIcon className="ml-auto size-4" />
																	) : (
																		<div className="ml-auto size-4" />
																	)}
																</ModelSelectorItem>
															))}
														</ModelSelectorGroup>
													),
												)}
											</ModelSelectorList>
										</ModelSelectorContent>
									</ModelSelector>
								)}
							</PromptInputTools>
							<PromptInputSubmit status={status} />
						</PromptInputFooter>
					</PromptInput>
				</PromptInputProvider>
			</div>

			<SettingsDialog />
		</div>
	);
}
