import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { PermissionModal } from "@/components/chat/permission-modal";
import { useChat } from "@/hooks/use-chat";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";

export default function ChatScreen() {
	const params = useLocalSearchParams<{
		chatId?: string | string[];
		readonly?: string | string[];
	}>();
	const chatId = Array.isArray(params.chatId)
		? params.chatId[0]
		: params.chatId;
	const isReadOnlyParam = params.readonly === "true";

	const {
		messages,
		terminalOutput,
		connStatus,
		pendingPermission,
		setActiveChatId,
		activeChatIsReadOnly,
		sessions,
		activeChatId,
		isChatFailed,
		addMessage,
		clearMessages,
		setConnStatus,
		setError,
		setModes,
		setModels,
		modes,
		models,
		commands,
		updateSessionStatus,
		clearChatFailed,
	} = useChatStore();

	const router = useRouter();
	const {
		sendMessage,
		setMode,
		setModel,
		respondToPermission,
		stopSession,
		resumeSession,
		isSending,
		isResuming,
	} = useChat();
	const insets = useSafeAreaInsets();
	const [inputHeight, setInputHeight] = useState(0);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [forceActive, setForceActive] = useState(false);
	const isReadOnly = isReadOnlyParam && !forceActive;

	useEffect(() => {
		setForceActive(false);
	}, [chatId]);

	// Query for historical messages (read-only mode)
	const messagesQuery = trpc.getSessionMessages.useQuery(
		{ chatId: chatId || "" },
		{
			enabled: isReadOnly && !!chatId,
		},
	);

	const handleInputHeightChange = useCallback((height: number) => {
		setInputHeight((current) => (current === height ? current : height));
	}, []);

	const handleModeChange = useCallback(
		(modeId: string) => {
			setMode(modeId);
		},
		[setMode],
	);

	const handleModelChange = useCallback(
		(modelId: string) => {
			setModel(modelId);
		},
		[setModel],
	);
	const listContentPadding = Math.max(100, inputHeight + insets.bottom + 16);
	const keyboardBottomOffset = inputHeight > 0 ? inputHeight + 16 : 0;

	// Load historical messages for read-only mode
	useEffect(() => {
		if (isReadOnly && messagesQuery.data && chatId) {
			setIsLoadingHistory(true);
			// Convert stored messages to chat messages format
			clearMessages();
			for (const msg of messagesQuery.data) {
				addMessage({
					id: msg.id,
					role: msg.role,
					parts: [
						...(msg.reasoning
							? [{ type: "reasoning" as const, text: msg.reasoning }]
							: []),
						{ type: "text" as const, text: msg.content },
					],
					timestamp: msg.timestamp,
				});
			}
			setConnStatus("idle"); // Read-only, not connected
			setIsLoadingHistory(false);
		}
	}, [
		isReadOnly,
		messagesQuery.data,
		chatId,
		addMessage,
		clearMessages,
		setConnStatus,
	]);

	// Initialize or Switch Chat (only for active sessions)
	useEffect(() => {
		if (!chatId) return;

		if (isReadOnly) {
			if (chatId !== activeChatId || !activeChatIsReadOnly) {
				setActiveChatId(chatId, true);
			}
			return;
		}

		// Don't try to activate a chat that has already failed
		if (chatId && isChatFailed(chatId)) {
			console.log("Chat has failed, navigating back", chatId);
			router.back();
			return;
		}

		if (chatId && chatId !== activeChatId) {
			console.log("Switching to chat", chatId);
			setActiveChatId(chatId, false);
			// The hook subscription will trigger based on activeChatId
		}
	}, [
		chatId,
		activeChatId,
		activeChatIsReadOnly,
		setActiveChatId,
		isChatFailed,
		router,
		isReadOnly,
	]);

	const currentSession = sessions.find((s) => s.id === chatId);

	const handleStop = async () => {
		await stopSession();
		router.replace("/" as any);
	};

	const handleResume = async () => {
		if (!chatId || isResuming) return;
		if (!currentSession) {
			setError(
				"Session metadata not loaded. Please reopen from the session list.",
			);
			return;
		}
		if (currentSession.loadSessionSupported === false) {
			setError("Agent does not support session resume for this chat.");
			return;
		}

		try {
			setForceActive(true);
			clearChatFailed(chatId);
			const res = await resumeSession(chatId);
			setActiveChatId(chatId, false);
			if (res?.modes) setModes(res.modes);
			if (res?.models) setModels(res.models);
			updateSessionStatus(chatId, "running");
			router.replace(`/chats/${chatId}` as any);
		} catch (err) {
			console.error("Failed to resume chat", err);
			setForceActive(false);
			setConnStatus("idle");
		}
	};

	if (!chatId) {
		return (
			<View className="flex-1 justify-center items-center bg-background">
				<Text className="text-foreground">No Chat ID</Text>
			</View>
		);
	}

	const showLoading = isReadOnly
		? messagesQuery.isLoading || isLoadingHistory
		: connStatus === "connecting" && messages.length === 0;
	const canResume = Boolean(currentSession?.loadSessionSupported);
	const readOnlySuffix = isReadOnly
		? canResume
			? " (Inactive)"
			: " (Read-only)"
		: "";

	return (
		<View className="flex-1 bg-background">
			<ChatHeader
				title={
					currentSession
						? `Chat ${(currentSession.sessionId ?? currentSession.id).slice(0, 8)}${readOnlySuffix}`
						: isReadOnly
							? canResume
								? "Chat (Inactive)"
								: "Chat (Read-only)"
							: "Chat"
				}
				status={isReadOnly ? "idle" : connStatus}
				onStop={handleStop}
				onResume={handleResume}
				isSessionStopped={
					isReadOnly ||
					connStatus === "idle" ||
					connStatus === "error" ||
					currentSession?.status === "stopped"
				}
				canResume={canResume}
			/>

			{/* Read-only banner */}
			{isReadOnly && (
				<View className="bg-default px-4 py-2 border-b border-divider">
					<Text className="text-muted text-sm text-center">
						{canResume
							? "This session is inactive. Tap Resume to continue."
							: "This session has ended. You can view the history but cannot send new messages."}
					</Text>
				</View>
			)}

			<View className="flex-1">
				{showLoading ? (
					<View className="flex-1 justify-center items-center">
						<ActivityIndicator size="large" color="#2563eb" />
						<Text className="text-muted mt-2">
							{isReadOnly ? "Loading history..." : "Connecting..."}
						</Text>
					</View>
				) : (
					<ChatMessages
						messages={messages}
						terminalOutputs={terminalOutput}
						contentPaddingBottom={listContentPadding}
						keyboardBottomOffset={keyboardBottomOffset}
					/>
				)}
			</View>

			{/* Only show input for active sessions */}
			{!isReadOnly && (
				<KeyboardStickyView>
					<ChatInput
						onSend={sendMessage}
						disabled={connStatus !== "connected" || isSending}
						onHeightChange={handleInputHeightChange}
						availableModes={modes?.availableModes ?? []}
						currentModeId={modes?.currentModeId ?? null}
						onModeChange={handleModeChange}
						availableModels={models?.availableModels ?? []}
						currentModelId={models?.currentModelId ?? null}
						onModelChange={handleModelChange}
						availableCommands={commands}
					/>
				</KeyboardStickyView>
			)}

			<PermissionModal
				request={pendingPermission}
				onApprove={respondToPermission}
				onReject={respondToPermission}
			/>
		</View>
	);
}
