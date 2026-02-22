import type {
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
  UIMessage,
} from "@repo/shared";
import { isChatBusyStatus } from "@repo/shared";
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import type { SendMessageOptions } from "./use-chat.types";

interface UseChatActionsParams {
  chatId: string | null | undefined;
  readOnly: boolean;
  models: SessionModelState | null;
  isActiveChat: (targetChatId: string) => boolean;
  statusRef: MutableRefObject<ChatStatus>;
  activeTurnIdRef: MutableRefObject<string | null>;
  isResumingRef: MutableRefObject<boolean>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setModes: Dispatch<SetStateAction<SessionModeState | null>>;
  setModels: Dispatch<SetStateAction<SessionModelState | null>>;
  setSupportsModelSwitching: Dispatch<SetStateAction<boolean>>;
  setConfigOptions: Dispatch<SetStateAction<SessionConfigOption[]>>;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  setMessages: (messages: UIMessage[]) => void;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  clearAllPendingUserMessageFallbacks: () => void;
  onLocalModeMutated?: () => void;
  onLocalModelMutated?: () => void;
  onLocalConfigOptionMutated?: () => void;
  schedulePendingUserMessageFallback: (
    activeChatId: string,
    messageId: string
  ) => void;
  invalidateHistoryLoads: () => void;
  clearHistoryWindow: () => void;
  loadHistory: (force?: boolean) => Promise<void>;
}

export function useChatActions({
  chatId,
  readOnly,
  models,
  isActiveChat,
  statusRef,
  activeTurnIdRef,
  isResumingRef,
  setStatus,
  setConnStatus,
  setError,
  setModes,
  setModels,
  setSupportsModelSwitching,
  setConfigOptions,
  setPendingPermission,
  setMessages,
  setStreamLifecycle,
  clearAllPendingUserMessageFallbacks,
  onLocalModeMutated,
  onLocalModelMutated,
  onLocalConfigOptionMutated,
  schedulePendingUserMessageFallback,
  invalidateHistoryLoads,
  clearHistoryWindow,
  loadHistory,
}: UseChatActionsParams) {
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const setConfigOptionMutation = trpc.setConfigOption.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const permissionResponseMutation =
    trpc.respondToPermissionRequest.useMutation();

  const sendMessage = useCallback(
    async (text: string, messageOptions?: SendMessageOptions) => {
      if (!chatId) {
        return false;
      }
      if (
        isChatBusyStatus(statusRef.current) ||
        sendMessageMutation.isPending ||
        Boolean(activeTurnIdRef.current)
      ) {
        return false;
      }
      const activeChatId = chatId;
      const previousStatus = statusRef.current;
      setStatus("submitted");
      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId: activeChatId,
          text,
          images: messageOptions?.images,
          resources: messageOptions?.resources,
          resourceLinks: messageOptions?.resourceLinks,
        });
        if (!isActiveChat(activeChatId) || readOnly) {
          return false;
        }
        activeTurnIdRef.current = res.turnId ?? null;
        schedulePendingUserMessageFallback(activeChatId, res.userMessageId);
        return res.status === "submitted";
      } catch (sendError) {
        console.error("Failed to send message", sendError);
        if (!isActiveChat(activeChatId) || readOnly) {
          return false;
        }
        setStatus(previousStatus);
        setError(
          sendError instanceof Error ? sendError.message : String(sendError)
        );
        return false;
      }
    },
    [
      activeTurnIdRef,
      chatId,
      isActiveChat,
      readOnly,
      schedulePendingUserMessageFallback,
      sendMessageMutation,
      setError,
      setStatus,
      statusRef,
    ]
  );

  const cancelPrompt = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    const previousStatus = statusRef.current;
    setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (cancelError) {
      if (!isActiveChat(activeChatId)) {
        return;
      }
      console.error("Failed to cancel prompt", cancelError);
      setError(
        cancelError instanceof Error ? cancelError.message : String(cancelError)
      );
      setStatus(previousStatus);
    }
  }, [cancelPromptMutation, chatId, isActiveChat, setError, setStatus, statusRef]);

  const setMode = useCallback(
    async (modeId: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev));
        onLocalModeMutated?.();
      } catch (modeError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        console.error("Failed to set mode", modeError);
        setError(modeError instanceof Error ? modeError.message : String(modeError));
      }
    },
    [chatId, isActiveChat, onLocalModeMutated, setError, setModeMutation, setModes]
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        console.info("[Chat] setModel requested", { chatId: activeChatId, modelId });
        await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setModels((prev) =>
          prev ? { ...prev, currentModelId: modelId } : prev
        );
        onLocalModelMutated?.();
        const modelName =
          models?.availableModels.find((model) => model.modelId === modelId)
            ?.name ?? modelId;
        toast.success(`Model switched to ${modelName}`);
        console.info("[Chat] setModel succeeded", {
          chatId: activeChatId,
          modelId,
        });
      } catch (modelError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        const message = (modelError as Error).message || "Failed to set model";
        const normalized = message.toLowerCase();
        if (
          normalized.includes("model switching") ||
          normalized.includes("method not found")
        ) {
          setSupportsModelSwitching(false);
        }
        console.error("[Chat] setModel failed", {
          chatId: activeChatId,
          modelId,
          error: message,
        });
        setError(message);
      }
    },
    [
      chatId,
      isActiveChat,
      models,
      onLocalModelMutated,
      setError,
      setModelMutation,
      setModels,
      setSupportsModelSwitching,
    ]
  );

  const setConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        const result = await setConfigOptionMutation.mutateAsync({
          chatId: activeChatId,
          configId,
          value,
        });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        if (Array.isArray(result?.configOptions)) {
          setConfigOptions(result.configOptions);
        } else {
          setConfigOptions((prev) =>
            prev.map((option) =>
              option.id === configId
                ? { ...option, currentValue: value }
                : option
            )
          );
        }
        onLocalConfigOptionMutated?.();
      } catch (configError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        console.error("Failed to set config option", configError);
        setError(
          configError instanceof Error ? configError.message : String(configError)
        );
      }
    },
    [
      chatId,
      isActiveChat,
      onLocalConfigOptionMutated,
      setConfigOptionMutation,
      setConfigOptions,
      setError,
    ]
  );

  const respondToPermission = useCallback(
    async (requestId: string, decision: string) => {
      if (!chatId) {
        return;
      }
      const activeChatId = chatId;
      try {
        await permissionResponseMutation.mutateAsync({
          chatId: activeChatId,
          requestId,
          decision,
        });
        if (!isActiveChat(activeChatId)) {
          return;
        }
        setPendingPermission(null);
      } catch (permissionError) {
        if (!isActiveChat(activeChatId)) {
          return;
        }
        console.error("Failed to respond to permission", permissionError);
        setError(
          permissionError instanceof Error
            ? permissionError.message
            : String(permissionError)
        );
      }
    },
    [
      chatId,
      isActiveChat,
      permissionResponseMutation,
      setError,
      setPendingPermission,
    ]
  );

  const stopSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    try {
      clearAllPendingUserMessageFallbacks();
      await stopSessionMutation.mutateAsync({ chatId: activeChatId });
      if (!isActiveChat(activeChatId)) {
        return;
      }
      setStreamLifecycle("idle");
      setConnStatus("idle");
      setStatus("inactive");
      activeTurnIdRef.current = null;
    } catch (stopError) {
      if (!isActiveChat(activeChatId)) {
        return;
      }
      console.error("Failed to stop session", stopError);
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    }
  }, [
    activeTurnIdRef,
    chatId,
    clearAllPendingUserMessageFallbacks,
    isActiveChat,
    setConnStatus,
    setError,
    setStatus,
    setStreamLifecycle,
    stopSessionMutation,
  ]);

  const resumeSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const activeChatId = chatId;
    try {
      isResumingRef.current = true;
      clearAllPendingUserMessageFallbacks();
      activeTurnIdRef.current = null;
      invalidateHistoryLoads();
      setStreamLifecycle("bootstrapping");
      setConnStatus("connecting");
      setStatus("connecting");
      const resumeResult = await resumeSessionMutation.mutateAsync({
        chatId: activeChatId,
      });
      if (!isActiveChat(activeChatId)) {
        isResumingRef.current = false;
        return;
      }
      const alreadyRunning =
        typeof resumeResult === "object" &&
        resumeResult !== null &&
        "alreadyRunning" in resumeResult &&
        Boolean((resumeResult as { alreadyRunning?: boolean }).alreadyRunning);
      let shouldReloadHistory = false;
      if (!alreadyRunning) {
        setMessages([]);
        clearHistoryWindow();
        shouldReloadHistory = true;
      }
      isResumingRef.current = false;
      if (shouldReloadHistory) {
        await loadHistory(true);
      }
    } catch (resumeError) {
      if (!isActiveChat(activeChatId)) {
        isResumingRef.current = false;
        return;
      }
      console.error("Failed to resume chat", resumeError);
      setConnStatus("error");
      setStatus("error");
      setError(
        resumeError instanceof Error ? resumeError.message : String(resumeError)
      );
      isResumingRef.current = false;
    }
  }, [
    activeTurnIdRef,
    chatId,
    clearAllPendingUserMessageFallbacks,
    clearHistoryWindow,
    invalidateHistoryLoads,
    isResumingRef,
    isActiveChat,
    loadHistory,
    resumeSessionMutation,
    setConnStatus,
    setError,
    setMessages,
    setStatus,
    setStreamLifecycle,
  ]);

  return {
    sendMessage,
    cancelPrompt,
    setMode,
    setModel,
    setConfigOption,
    respondToPermission,
    stopSession,
    resumeSession,
    isSending: sendMessageMutation.isPending,
    isCancelling: cancelPromptMutation.isPending,
    isResuming: resumeSessionMutation.isPending,
  };
}
