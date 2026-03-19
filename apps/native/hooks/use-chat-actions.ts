import type { ChatStatus, UseChatOptions } from "@repo/shared";
import { isChatBusyStatus } from "@repo/shared";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  deriveResumeSessionSyncPlan,
  isRuntimeAuthoritativeHistory,
} from "@/hooks/use-chat-session-sync";
import {
  nextLifecycleOnSubscriptionError,
  type StreamLifecycle,
} from "@/hooks/use-chat-stream-machine";
import {
  rememberBlockedTurnId,
  shouldRollbackSendMessageFailure,
} from "@/hooks/use-chat-turn-guards";
import { type Attachment, buildSendMessagePayload } from "@/lib/attachments";
import { trpc } from "@/lib/trpc";
import { type ConnectionStatus, useChatStore } from "@/store/chat-store";

type SendMessageInput =
  | string
  | {
      text: string;
      files?: Attachment[];
      metadata?: unknown;
      messageId?: string;
    };

interface ToolApprovalResponse {
  id: string;
  approved: boolean;
  reason?: string;
}

function readTrpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as {
    data?: { code?: unknown } | null;
    shape?: { data?: { code?: unknown } | null } | null;
  };
  const code = candidate.data?.code ?? candidate.shape?.data?.code;
  return typeof code === "string" ? code : null;
}

interface UseChatActionRefs {
  activeTurnIdRef: MutableRefObject<string | null>;
  blockedTurnIdsRef: MutableRefObject<Set<string>>;
  completedTurnIdsRef: MutableRefObject<Set<string>>;
  connectedChatIdRef: MutableRefObject<string | null>;
  statusRef: MutableRefObject<ChatStatus>;
  connStatusRef: MutableRefObject<ConnectionStatus>;
  isResumingRef: MutableRefObject<boolean>;
  resumePromiseRef: MutableRefObject<Promise<unknown> | null>;
  onErrorRef: MutableRefObject<UseChatOptions["onError"] | undefined>;
}

interface UseChatActionsParams {
  activeChatId: string | null;
  ensureLiveSubscription: () => Promise<boolean>;
  loadHistory: (force?: boolean) => Promise<boolean>;
  deleteSessionById: (chatId: string) => Promise<boolean>;
  refs: UseChatActionRefs;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  setSubscriptionEpoch: Dispatch<SetStateAction<number>>;
}

export function useChatActions({
  activeChatId,
  ensureLiveSubscription,
  loadHistory,
  deleteSessionById,
  refs,
  setStreamLifecycle,
  setSubscriptionEpoch,
}: UseChatActionsParams) {
  const utils = trpc.useUtils();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const setConfigOptionMutation = trpc.setConfigOption.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const respondToPermissionMutation =
    trpc.respondToPermissionRequest.useMutation();

  const isCurrentLiveChat = useCallback((chatId: string) => {
    const store = useChatStore.getState();
    return (
      store.activeChatId === chatId && store.activeChatIsReadOnly === false
    );
  }, []);

  const sendMessage = useCallback(
    async (
      input?: SendMessageInput,
      attachments: Attachment[] = []
    ): Promise<boolean> => {
      if (!activeChatId || sendMessageMutation.isPending) {
        return false;
      }

      const store = useChatStore.getState();
      const normalized =
        typeof input === "string" ? { text: input, files: attachments } : input;

      if (!normalized?.text) {
        store.setError("Message text is required");
        return false;
      }
      if (normalized.messageId) {
        const message = "Editing messages is not supported by this client";
        store.setError(message);
        throw new Error(message);
      }

      if (
        refs.activeTurnIdRef.current &&
        !isChatBusyStatus(refs.statusRef.current)
      ) {
        refs.activeTurnIdRef.current = null;
      }

      const hasLiveSubscription = await ensureLiveSubscription();
      if (!(hasLiveSubscription && isCurrentLiveChat(activeChatId))) {
        if (!hasLiveSubscription && isCurrentLiveChat(activeChatId)) {
          store.setError("Realtime stream is not connected yet. Please retry.");
        }
        return false;
      }

      setStreamLifecycle((prev) => (prev === "idle" ? "bootstrapping" : prev));
      if (refs.connStatusRef.current === "idle") {
        store.setConnStatus("connecting");
      }

      const previousStatus = refs.statusRef.current;
      store.setStatus("submitted");

      try {
        const payload = buildSendMessagePayload(
          normalized.text,
          normalized.files ?? []
        );
        const result = await sendMessageMutation.mutateAsync({
          chatId: activeChatId,
          ...payload,
        });
        if (!isCurrentLiveChat(activeChatId)) {
          return false;
        }
        store.setError(null);
        refs.activeTurnIdRef.current = result.turnId ?? null;
        if (result.turnId) {
          refs.blockedTurnIdsRef.current.delete(result.turnId);
        }
        return true;
      } catch (error) {
        if (!isCurrentLiveChat(activeChatId)) {
          return false;
        }
        if (!shouldRollbackSendMessageFailure(refs.statusRef.current)) {
          return true;
        }
        if (readTrpcErrorCode(error) === "CONFLICT") {
          setStreamLifecycle((prev) =>
            prev === "idle" ? "bootstrapping" : prev
          );
          if (refs.connStatusRef.current === "idle") {
            store.setConnStatus("connecting");
          }
        }
        const message =
          error instanceof Error ? error.message : "Failed to send message";
        store.setError(message);
        store.setStatus(previousStatus);
        refs.onErrorRef.current?.(message);
        return false;
      }
    },
    [
      activeChatId,
      ensureLiveSubscription,
      isCurrentLiveChat,
      refs.activeTurnIdRef,
      refs.blockedTurnIdsRef,
      refs.connStatusRef,
      refs.onErrorRef,
      refs.statusRef,
      sendMessageMutation,
      setStreamLifecycle,
    ]
  );

  const setMode = useCallback(
    async (modeId: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const store = useChatStore.getState();
        if (store.modes) {
          store.setModes({ ...store.modes, currentModeId: modeId });
        }
      } catch (error) {
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to set mode";
        const store = useChatStore.getState();
        store.setError(message);
        refs.onErrorRef.current?.(message);
      }
    },
    [activeChatId, isCurrentLiveChat, refs.onErrorRef, setModeMutation]
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const store = useChatStore.getState();
        if (store.models) {
          store.setModels({ ...store.models, currentModelId: modelId });
        }
      } catch (error) {
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to set model";
        const normalized = message.toLowerCase();
        const store = useChatStore.getState();
        if (
          normalized.includes("model switching") ||
          normalized.includes("method not found")
        ) {
          store.setSupportsModelSwitching(false);
        }
        store.setError(message);
        refs.onErrorRef.current?.(message);
      }
    },
    [activeChatId, isCurrentLiveChat, refs.onErrorRef, setModelMutation]
  );

  const setConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        const result = await setConfigOptionMutation.mutateAsync({
          chatId: activeChatId,
          configId,
          value,
        });
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const store = useChatStore.getState();
        const nextConfigOptions = Array.isArray(result?.configOptions)
          ? result.configOptions
          : store.configOptions.map((option) =>
              option.id === configId
                ? { ...option, currentValue: value }
                : option
            );
        store.setConfigOptions(nextConfigOptions);
      } catch (error) {
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Failed to set config option";
        const store = useChatStore.getState();
        store.setError(message);
        refs.onErrorRef.current?.(message);
      }
    },
    [activeChatId, isCurrentLiveChat, refs.onErrorRef, setConfigOptionMutation]
  );

  const cancelPrompt = useCallback(async () => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    const previousStatus = store.status;
    store.setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (error) {
      if (!isCurrentLiveChat(activeChatId)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to cancel prompt";
      store.setError(message);
      store.setStatus(previousStatus);
      refs.onErrorRef.current?.(message);
    }
  }, [activeChatId, cancelPromptMutation, isCurrentLiveChat, refs.onErrorRef]);

  const respondToPermission = useCallback(
    async (requestId: string, decision: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        await respondToPermissionMutation.mutateAsync({
          chatId: activeChatId,
          requestId,
          decision,
        });
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        useChatStore.getState().setPendingPermission(null);
      } catch (error) {
        if (!isCurrentLiveChat(activeChatId)) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Failed to respond to permission request";
        const store = useChatStore.getState();
        store.setError(message);
        refs.onErrorRef.current?.(message);
      }
    },
    [
      activeChatId,
      isCurrentLiveChat,
      refs.onErrorRef,
      respondToPermissionMutation,
    ]
  );

  const addToolApprovalResponse = useCallback(
    async (response: ToolApprovalResponse) => {
      const decision =
        response.reason ?? (response.approved ? "allow" : "reject");
      await respondToPermission(response.id, decision);
    },
    [respondToPermission]
  );

  const stopSession = useCallback(async () => {
    if (!activeChatId) {
      return;
    }
    try {
      await stopSessionMutation.mutateAsync({ chatId: activeChatId });
      if (!isCurrentLiveChat(activeChatId)) {
        return;
      }
      const store = useChatStore.getState();
      rememberBlockedTurnId(
        refs.blockedTurnIdsRef.current,
        refs.activeTurnIdRef.current
      );
      refs.activeTurnIdRef.current = null;
      refs.connectedChatIdRef.current = null;
      setStreamLifecycle("idle");
      store.setConnStatus("idle");
      store.setStatus("inactive");
    } catch (error) {
      if (!isCurrentLiveChat(activeChatId)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to stop session";
      const store = useChatStore.getState();
      store.setError(message);
      refs.onErrorRef.current?.(message);
    }
  }, [
    activeChatId,
    isCurrentLiveChat,
    refs.activeTurnIdRef,
    refs.blockedTurnIdsRef,
    refs.connectedChatIdRef,
    refs.onErrorRef,
    setStreamLifecycle,
    stopSessionMutation,
  ]);

  const deleteSession = useCallback(
    async (chatId?: string) => {
      const targetChatId = chatId ?? activeChatId;
      if (!targetChatId) {
        return false;
      }
      return await deleteSessionById(targetChatId);
    },
    [activeChatId, deleteSessionById]
  );

  const resumeSession = useCallback(
    async (chatId: string) => {
      if (refs.resumePromiseRef.current) {
        return refs.resumePromiseRef.current;
      }

      const resumeOperation = (async () => {
        const store = useChatStore.getState();
        refs.isResumingRef.current = true;
        refs.activeTurnIdRef.current = null;
        refs.blockedTurnIdsRef.current = new Set();
        refs.completedTurnIdsRef.current = new Set();
        refs.connectedChatIdRef.current = null;
        setStreamLifecycle("bootstrapping");
        store.setConnStatus("connecting");
        store.setStatus("connecting");
        await utils.getSessionState.cancel({ chatId });
        const result = await resumeSessionMutation.mutateAsync({ chatId });
        const syncPlan = deriveResumeSessionSyncPlan(result);
        const runtimeAuthoritativeHistory = isRuntimeAuthoritativeHistory({
          alreadyRunning: syncPlan.alreadyRunning,
          sessionLoadMethod: syncPlan.sessionLoadMethod,
        });
        setSubscriptionEpoch((current) => current + 1);
        await utils.getSessionState.invalidate({ chatId });
        if (!isCurrentLiveChat(chatId)) {
          refs.isResumingRef.current = false;
          return result;
        }
        if (syncPlan.modes !== undefined) {
          store.setModes(syncPlan.modes ?? null);
        }
        if (syncPlan.models !== undefined) {
          store.setModels(syncPlan.models ?? null);
        }
        if (syncPlan.supportsModelSwitching !== undefined) {
          store.setSupportsModelSwitching(syncPlan.supportsModelSwitching);
        }
        if (result?.promptCapabilities !== undefined) {
          store.setPromptCapabilities(result.promptCapabilities);
        }
        store.setMessages([]);
        store.setPendingPermission(null);
        store.setConnStatus("connected");
        store.setStatus("ready");
        refs.isResumingRef.current = false;
        if (runtimeAuthoritativeHistory) {
          await loadHistory(true);
          return result;
        }
        await loadHistory(true);
        return result;
      })();

      refs.resumePromiseRef.current = resumeOperation;

      try {
        return await resumeOperation;
      } catch (error) {
        if (isCurrentLiveChat(chatId)) {
          const message =
            error instanceof Error ? error.message : "Failed to resume session";
          const store = useChatStore.getState();
          store.setError(message);
          setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
          store.setConnStatus("connecting");
          store.setStatus("connecting");
          refs.onErrorRef.current?.(message);
        }
        throw error;
      } finally {
        if (refs.isResumingRef.current) {
          refs.isResumingRef.current = false;
        }
        if (refs.resumePromiseRef.current === resumeOperation) {
          refs.resumePromiseRef.current = null;
        }
      }
    },
    [
      isCurrentLiveChat,
      loadHistory,
      refs.activeTurnIdRef,
      refs.blockedTurnIdsRef,
      refs.completedTurnIdsRef,
      refs.connectedChatIdRef,
      refs.isResumingRef,
      refs.onErrorRef,
      refs.resumePromiseRef,
      resumeSessionMutation,
      setStreamLifecycle,
      setSubscriptionEpoch,
      utils.getSessionState,
    ]
  );

  const resumeStream = useCallback(async () => {
    if (!activeChatId) {
      return;
    }
    await resumeSession(activeChatId);
  }, [activeChatId, resumeSession]);

  const clearError = useCallback(() => {
    useChatStore.getState().setError(null);
  }, []);

  return {
    sendMessage,
    setMode,
    setModel,
    setConfigOption,
    stop: cancelPrompt,
    respondToPermission,
    addToolApprovalResponse,
    stopSession,
    deleteSession,
    resumeSession,
    resumeStream,
    clearError,
  };
}
