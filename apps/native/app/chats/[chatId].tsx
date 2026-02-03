import { isChatBusyStatus, type UIMessage } from "@repo/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader } from "@/components/chat/chat-header/chat-header";
import { AttachmentModal } from "@/components/chat/chat-input/attachment-modal";
import { ChatInput } from "@/components/chat/chat-input/chat-input";
import { ChatMessages } from "@/components/chat/chat-message/chat-messages";
import { PermissionModal } from "@/components/chat/permission-modal";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { useChat } from "@/hooks/use-chat";
import { useMessageAttachments } from "@/hooks/use-message-attachments";
import { trpc } from "@/lib/trpc";
import type { ConnectionStatus, SessionInfo } from "@/store/chat-store";
import { useChatStore } from "@/store/chat-store";

type ResumeValidationResult =
  | { valid: true; session: SessionInfo }
  | { valid: false; message: string };

function validateResumeSession(
  chatId: string | undefined,
  connStatus: ConnectionStatus,
  session: SessionInfo | undefined
): ResumeValidationResult {
  if (!chatId || connStatus === "connecting") {
    return { valid: false, message: "" };
  }
  if (!session) {
    return {
      valid: false,
      message:
        "Session metadata not loaded. Please reopen from the session list.",
    };
  }
  if (session.loadSessionSupported === false) {
    return {
      valid: false,
      message: "Agent does not support session resume for this chat.",
    };
  }
  return { valid: true, session };
}

function computeChatTitle(
  session: SessionInfo | undefined,
  isReadOnly: boolean,
  canResume: boolean
): string {
  if (session) {
    let suffix = "";
    if (isReadOnly) {
      suffix = canResume ? " (Inactive)" : " (Read-only)";
    }
    return `Chat ${(session.sessionId ?? session.id).slice(0, 8)}${suffix}`;
  }
  if (isReadOnly) {
    return canResume ? "Chat (Inactive)" : "Chat (Read-only)";
  }
  return "Chat";
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    chatId?: string | string[];
    readonly?: string | string[];
  }>();
  const chatId = Array.isArray(params.chatId)
    ? params.chatId[0]
    : params.chatId;
  const isReadOnlyParam = params.readonly === "true";

  // Guard: redirect chatId="new" to / (Sessions screen)
  useEffect(() => {
    if (chatId === "new") {
      router.replace("/");
    }
  }, [chatId, router]);

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
    setMessages,
    clearSessionView,
    setConnStatus,
    setError,
    modes,
    models,
    commands,
    updateSessionStatus,
    clearChatFailed,
    promptCapabilities,
    supportsModelSwitching,
  } = useChatStore();

  const {
    sendMessage,
    setMode,
    setModel,
    respondToPermission,
    stop,
    stopSession,
    resumeSession,
    status,
  } = useChat();
  const insets = useSafeAreaInsets();
  const [inputHeight, setInputHeight] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [forceActive, setForceActive] = useState(false);
  const {
    attachments,
    canAttachAudio,
    canAttachImages,
    canAttachResources,
    isAttachmentModalOpen,
    openAttachmentModal,
    closeAttachmentModal,
    pickAudio,
    pickImages,
    pickResource,
    removeAttachment,
    resetAttachments,
  } = useMessageAttachments({ promptCapabilities });
  const isReadOnly = isReadOnlyParam && !forceActive;
  const isConfigured = useAuthConfigured();
  useEffect(() => {
    setForceActive(false);
  }, []);

  useEffect(() => {
    resetAttachments();
  }, [chatId, resetAttachments]);

  // Query for historical messages (read-only mode)
  const messagesQuery = trpc.getSessionMessages.useQuery(
    { chatId: chatId || "" },
    {
      enabled: isConfigured && isReadOnly && !!chatId,
    }
  );

  const handleInputHeightChange = useCallback((height: number) => {
    setInputHeight((current) => (current === height ? current : height));
  }, []);

  const handleModeChange = useCallback(
    (modeId: string) => {
      setMode(modeId);
    },
    [setMode]
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      setModel(modelId);
    },
    [setModel]
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      const normalizedText = text.trim().length > 0 ? text : "";
      const sent = await sendMessage(normalizedText, attachments);
      if (sent) {
        resetAttachments();
      }
    },
    [attachments, resetAttachments, sendMessage]
  );
  const listContentPadding = Math.max(100, inputHeight + insets.bottom + 16);
  const keyboardBottomOffset = inputHeight > 0 ? inputHeight + 16 : 0;

  // Load historical messages for read-only mode
  useEffect(() => {
    const canLoad = isReadOnly && messagesQuery.data && chatId;
    if (!canLoad) {
      return;
    }

    setIsLoadingHistory(true);
    setMessages(messagesQuery.data as UIMessage[]);
    setConnStatus("idle");
    setIsLoadingHistory(false);
  }, [isReadOnly, messagesQuery.data, chatId, setMessages, setConnStatus]);

  // Initialize or Switch Chat (only for active sessions)
  useEffect(() => {
    if (!chatId) {
      return;
    }

    if (isReadOnly) {
      if (chatId !== activeChatId || !activeChatIsReadOnly) {
        setActiveChatId(chatId, true);
      }
      return;
    }

    if (isChatFailed(chatId)) {
      console.log("Chat has failed, navigating back", chatId);
      router.back();
      return;
    }

    if (chatId !== activeChatId || activeChatIsReadOnly) {
      console.log("Switching to chat", chatId);
      setActiveChatId(chatId, false);
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

  const canResumeChat = currentSession?.loadSessionSupported === true;
  const isSessionStopped =
    isReadOnly ||
    connStatus === "idle" ||
    connStatus === "error" ||
    currentSession?.status === "stopped";

  const handleStop = async () => {
    await stopSession();
    router.replace("/");
  };

  const handleResume = async () => {
    const validation = validateResumeSession(
      chatId,
      connStatus,
      currentSession
    );
    if (!validation.valid) {
      if (validation.message) {
        setError(validation.message);
      }
      return;
    }

    const validChatId = chatId as string;
    try {
      setForceActive(true);
      clearChatFailed(validChatId);
      setError(null);
      clearSessionView();
      setActiveChatId(validChatId, false);
      await resumeSession(validChatId);
      updateSessionStatus(validChatId, "running");
      router.replace(`/chats/${validChatId}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to resume chat.";
      console.error("Failed to resume chat", err);
      setForceActive(false);
      setActiveChatId(validChatId, true);
      setError(message);
    }
  };

  if (!chatId) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-foreground">No Chat ID</Text>
      </View>
    );
  }

  const showLoading = isReadOnly
    ? messagesQuery.isLoading || isLoadingHistory
    : connStatus === "connecting" && messages.length === 0;
  const chatTitle = computeChatTitle(currentSession, isReadOnly, canResumeChat);
  const isStreaming = useMemo(() => {
    if (isReadOnly || connStatus !== "connected") {
      return false;
    }
    return isChatBusyStatus(status);
  }, [connStatus, isReadOnly, status]);

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <ChatHeader
        canResume={canResumeChat}
        isSessionStopped={isSessionStopped}
        onResume={handleResume}
        onStop={handleStop}
        status={isReadOnly ? "idle" : connStatus}
        title={chatTitle}
      />

      {/* Read-only banner */}
      {isReadOnly && (
        <View className="border-divider border-b bg-default px-4 py-2">
          <Text className="text-center text-muted text-sm">
            {canResumeChat
              ? "This session is inactive. Tap Resume to continue."
              : "This session has ended. You can view the history but cannot send new messages."}
          </Text>
        </View>
      )}

      <View className="flex-1">
        {showLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#2563eb" size="large" />
            <Text className="mt-2 text-muted">
              {isReadOnly ? "Loading history..." : "Connecting..."}
            </Text>
          </View>
        ) : (
          <ChatMessages
            contentPaddingBottom={listContentPadding}
            isStreaming={isStreaming}
            keyboardBottomOffset={keyboardBottomOffset}
            messages={messages}
            terminalOutputs={terminalOutput}
          />
        )}
      </View>

      {/* Only show input for active sessions */}
      {!isReadOnly && (
        <KeyboardStickyView>
          <ChatInput
            attachments={attachments}
            availableCommands={commands}
            availableModels={models?.availableModels ?? []}
            availableModes={modes?.availableModes ?? []}
            currentModeId={modes?.currentModeId ?? null}
            currentModelId={models?.currentModelId ?? null}
            disabled={connStatus !== "connected" || status !== "ready"}
            onHeightChange={handleInputHeightChange}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
            onOpenAttachment={openAttachmentModal}
            onRemoveAttachment={removeAttachment}
            onSend={handleSendMessage}
            onStop={stop}
            status={status}
            supportsModelSwitching={supportsModelSwitching}
          />
        </KeyboardStickyView>
      )}

      <AttachmentModal
        canPickAudio={canAttachAudio}
        canPickImage={canAttachImages}
        canPickResource={canAttachResources}
        isOpen={isAttachmentModalOpen}
        onClose={closeAttachmentModal}
        onPickAudio={pickAudio}
        onPickImage={pickImages}
        onPickResource={pickResource}
      />

      <PermissionModal
        onRespond={respondToPermission}
        request={pendingPermission}
      />
    </View>
  );
}
