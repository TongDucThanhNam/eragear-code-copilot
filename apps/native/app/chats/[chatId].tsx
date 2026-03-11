import { Ionicons } from "@expo/vector-icons";
import { Button, Surface, useThemeColor } from "heroui-native";
import { isChatBusyStatus, type UIMessage } from "@repo/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/react/shallow";
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

const HISTORY_PAGE_LIMIT = 200;

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

function getProjectLabel(projectRoot: string | undefined): string | null {
  if (!projectRoot) {
    return null;
  }

  const segments = projectRoot.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

function computeChatSubtitle(
  session: SessionInfo | undefined,
  isReadOnly: boolean,
  canResume: boolean
): string | undefined {
  const projectLabel = getProjectLabel(session?.projectRoot);

  if (isReadOnly) {
    const modeLabel = canResume ? "Resume available" : "History only";
    return projectLabel ? `${projectLabel} • ${modeLabel}` : modeLabel;
  }

  return projectLabel ?? "Live coding session";
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
    messageIds,
    connStatus,
    pendingPermission,
    setActiveChatId,
    activeChatIsReadOnly,
    sessions,
    activeChatId,
    isChatFailed,
    setMessages,
    setError,
    modes,
    models,
    commands,
    updateSessionStatus,
    clearChatFailed,
    promptCapabilities,
    supportsModelSwitching,
  } = useChatStore(
    useShallow((state) => ({
      messageIds: state.messageIds,
      connStatus: state.connStatus,
      pendingPermission: state.pendingPermission,
      setActiveChatId: state.setActiveChatId,
      activeChatIsReadOnly: state.activeChatIsReadOnly,
      sessions: state.sessions,
      activeChatId: state.activeChatId,
      isChatFailed: state.isChatFailed,
      setMessages: state.setMessages,
      setError: state.setError,
      modes: state.modes,
      models: state.models,
      commands: state.commands,
      updateSessionStatus: state.updateSessionStatus,
      clearChatFailed: state.clearChatFailed,
      promptCapabilities: state.promptCapabilities,
      supportsModelSwitching: state.supportsModelSwitching,
    }))
  );

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
  const accentColor = useThemeColor("accent");
  const [inputHeight, setInputHeight] = useState(0);
  const [forceActive, setForceActive] = useState(false);
  const [isResumePending, setIsResumePending] = useState(false);
  const appliedHistoryRef = useRef<string | null>(null);
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
  const messagesQuery = trpc.getSessionMessagesPage.useQuery(
    {
      chatId: chatId || "",
      direction: "backward",
      limit: HISTORY_PAGE_LIMIT,
      includeCompacted: true,
    },
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

  // Load historical messages for read-only mode
  useEffect(() => {
    if (!(isReadOnly && messagesQuery.data && chatId)) {
      return;
    }

    const history = messagesQuery.data.messages as UIMessage[];
    const firstId = history[0]?.id ?? "none";
    const lastId = history[history.length - 1]?.id ?? "none";
    const signature = `${chatId}:${history.length}:${firstId}:${lastId}`;

    if (appliedHistoryRef.current === signature) {
      return;
    }

    appliedHistoryRef.current = signature;
    setMessages(history);
  }, [isReadOnly, messagesQuery.data, chatId, setMessages]);

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
    if (isResumePending) {
      return;
    }
    try {
      setIsResumePending(true);
      setForceActive(true);
      clearChatFailed(validChatId);
      setError(null);
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
    } finally {
      setIsResumePending(false);
    }
  };

  if (!chatId) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 dark:bg-black">
        <Surface className="w-full max-w-sm rounded-[28px] border border-divider/70 px-6 py-7">
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-accent/10">
            <Ionicons color={accentColor} name="chatbubbles-outline" size={28} />
          </View>
          <Text className="font-semibold text-foreground text-xl">
            No chat selected
          </Text>
          <Text className="mt-2 text-muted-foreground text-sm leading-6">
            Pick a session from the list or create a new one before opening the
            chat view.
          </Text>
          <Button
            className="mt-5 self-start rounded-2xl"
            onPress={() => router.replace("/")}
            variant="secondary"
          >
            Back to sessions
          </Button>
        </Surface>
      </View>
    );
  }

  const showLoading = isReadOnly
    ? messagesQuery.isLoading || messagesQuery.isFetching
    : connStatus === "connecting" && messageIds.length === 0;
  const chatTitle = computeChatTitle(currentSession, isReadOnly, canResumeChat);
  const chatSubtitle = computeChatSubtitle(
    currentSession,
    isReadOnly,
    canResumeChat
  );
  const isStreaming = useMemo(() => {
    if (isReadOnly || connStatus !== "connected") {
      return false;
    }
    return isChatBusyStatus(status);
  }, [connStatus, isReadOnly, status]);

  return (
    <View
      className="flex-1 bg-background dark:bg-black"
      style={{
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <ChatHeader
        availableModels={models?.availableModels ?? []}
        availableModes={modes?.availableModes ?? []}
        canResume={canResumeChat}
        currentModeId={modes?.currentModeId ?? null}
        currentModelId={models?.currentModelId ?? null}
        disabled={connStatus !== "connected"}
        isResumePending={isResumePending || connStatus === "connecting"}
        isSessionStopped={isSessionStopped}
        onModeChange={handleModeChange}
        onModelChange={handleModelChange}
        onResume={handleResume}
        onStop={handleStop}
        status={isReadOnly ? "idle" : connStatus}
        subtitle={chatSubtitle}
        supportsModelSwitching={supportsModelSwitching}
        title={chatTitle}
      />

      {isReadOnly && (
        <Surface
          className="mx-4 mt-3 rounded-2xl border border-divider/60 px-4 py-3"
          variant="secondary"
        >
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="font-medium text-foreground text-sm">
                {canResumeChat ? "Session paused" : "History only"}
              </Text>
              <Text className="mt-1 text-muted-foreground text-sm">
                {canResumeChat
                  ? "Resume to continue this conversation."
                  : "Transcript is available, but new messages are disabled."}
              </Text>
            </View>
            {canResumeChat ? (
              <Button
                className="rounded-2xl"
                isDisabled={isResumePending}
                onPress={handleResume}
                size="sm"
              >
                {isResumePending ? "Resuming..." : "Resume"}
              </Button>
            ) : null}
          </View>
        </Surface>
      )}

      <View className="flex-1">
        {showLoading ? (
          <View className="flex-1 items-center justify-center px-6">
            <ActivityIndicator color={accentColor} size="large" />
            <Text className="mt-4 font-medium text-foreground text-base">
              {isReadOnly ? "Loading history" : "Restoring session"}
            </Text>
            <Text className="mt-1 text-center text-muted-foreground text-sm">
              {isReadOnly
                ? "Fetching the stored transcript."
                : "Reconnecting and syncing messages."}
            </Text>
          </View>
        ) : (
          <ChatMessages
            contentPaddingBottom={listContentPadding}
            isStreaming={isStreaming}
            messageIds={messageIds}
          />
        )}
      </View>

      {/* Only show input for active sessions */}
      {!isReadOnly && (
        <KeyboardStickyView>
          <ChatInput
            attachments={attachments}
            availableCommands={commands}
            disabled={connStatus !== "connected" || status !== "ready"}
            onHeightChange={handleInputHeightChange}
            onOpenAttachment={openAttachmentModal}
            onRemoveAttachment={removeAttachment}
            onSend={handleSendMessage}
            onStop={stop}
            status={status}
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
