import type { BroadcastEvent, UseChatOptions } from "@repo/shared";
import {
  type ChatStatus,
  isChatBusyStatus,
  parseBroadcastEventClientSafe,
  processSessionEvent,
} from "@repo/shared";
import { NotificationFeedbackType, notificationAsync } from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { useChatHistorySync } from "@/hooks/use-chat-history-sync";
import { useChatMessageStream } from "@/hooks/use-chat-message-stream";
import {
  deriveResumeSessionSyncPlan,
  getChatFinishHistoryReloadDecision,
  shouldFinalizeAfterReadyStatus,
} from "@/hooks/use-chat-session-sync";
import {
  isLiveSubscriptionReady,
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  type StreamLifecycle,
} from "@/hooks/use-chat-stream-machine";
import {
  hasObservedTurnCompletion,
  rememberBlockedTurnId,
  rememberCompletedTurnId,
  resolveSessionEventTurnGuard,
  shouldRollbackSendMessageFailure,
} from "@/hooks/use-chat-turn-guards";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { type Attachment, buildSendMessagePayload } from "@/lib/attachments";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";

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

const LIVE_SUBSCRIPTION_TIMEOUT_MS = 4000;
const LIVE_SUBSCRIPTION_POLL_MS = 50;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function useChat(options: UseChatOptions = {}) {
  const { onFinish, onError } = options;
  const isConfigured = useAuthConfigured();
  const {
    activeChatId,
    activeChatIsReadOnly,
    status,
    connStatus,
    modes,
    models,
    supportsModelSwitching,
    commands,
    configOptions,
    sessionInfo,
    promptCapabilities,
    agentInfo,
    loadSessionSupported,
    pendingPermission,
    error,
    isChatFailed,
    getMessageById,
  } = useChatStore(
    useShallow((state) => ({
      activeChatId: state.activeChatId,
      activeChatIsReadOnly: state.activeChatIsReadOnly,
      status: state.status,
      connStatus: state.connStatus,
      modes: state.modes,
      models: state.models,
      supportsModelSwitching: state.supportsModelSwitching,
      commands: state.commands,
      configOptions: state.configOptions,
      sessionInfo: state.sessionInfo,
      promptCapabilities: state.promptCapabilities,
      agentInfo: state.agentInfo,
      loadSessionSupported: state.loadSessionSupported,
      pendingPermission: state.pendingPermission,
      error: state.error,
      isChatFailed: state.isChatFailed,
      getMessageById: state.getMessageById,
    }))
  );

  const hapticTriggeredRef = useRef<Set<string>>(new Set());
  const onFinishRef = useRef(onFinish);
  const onErrorRef = useRef(onError);
  const isResumingRef = useRef(false);
  const resumePromiseRef = useRef<Promise<unknown> | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  const connectedChatIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const blockedTurnIdsRef = useRef<Set<string>>(new Set());
  const completedTurnIdsRef = useRef<Set<string>>(new Set());
  const statusRef = useRef<ChatStatus>(status);
  const connStatusRef = useRef(connStatus);
  const [streamLifecycle, setStreamLifecycle] = useState<StreamLifecycle>(
    nextLifecycleOnChatIdChange({
      hasChatId: Boolean(activeChatId),
      readOnly: activeChatIsReadOnly,
    })
  );
  const previousStreamLifecycleRef = useRef(streamLifecycle);
  const streamLifecycleRef = useRef(streamLifecycle);
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
  const {
    applyMessagesImmediate,
    applyMessagePartUpdate,
    getMessageByIdWithPending,
    resetPendingMessages,
  } = useChatMessageStream({ getMessageById });

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  activeChatIdRef.current = activeChatId;
  statusRef.current = status;
  connStatusRef.current = connStatus;
  streamLifecycleRef.current = streamLifecycle;

  useEffect(() => {
    hapticTriggeredRef.current = new Set();
    resetPendingMessages();
    activeTurnIdRef.current = null;
    blockedTurnIdsRef.current = new Set();
    completedTurnIdsRef.current = new Set();
    connectedChatIdRef.current = null;
    setStreamLifecycle(
      nextLifecycleOnChatIdChange({
        hasChatId: Boolean(activeChatId),
        readOnly: activeChatIsReadOnly,
      })
    );
  }, [activeChatId, activeChatIsReadOnly, resetPendingMessages]);

  const triggerStreamEndHaptic = useCallback((messageId?: string) => {
    if (Platform.OS === "web") {
      return;
    }
    if (!messageId) {
      return;
    }

    const triggered = hapticTriggeredRef.current;
    if (!triggered.has(messageId)) {
      triggered.add(messageId);
      notificationAsync(NotificationFeedbackType.Success);
    }
  }, []);

  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const setConfigOptionMutation = trpc.setConfigOption.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const respondToPermissionMutation =
    trpc.respondToPermissionRequest.useMutation();
  const { deleteSession: deleteSessionById } = useDeleteSession();
  const { loadHistory, finalizeMessagesInStore, utils } = useChatHistorySync({
    activeChatId,
    activeChatIsReadOnly,
    connStatus,
    isConfigured,
    isResumingRef,
    onErrorRef,
    streamLifecycle,
    streamLifecycleRef,
  });

  useEffect(() => {
    const previous = previousStreamLifecycleRef.current;
    if (previous === "recovering" && streamLifecycle === "live") {
      loadHistory(true);
    }
    previousStreamLifecycleRef.current = streamLifecycle;
  }, [loadHistory, streamLifecycle]);

  const handleSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      if (
        event.type === "chat_finish" &&
        hasObservedTurnCompletion(
          completedTurnIdsRef.current,
          event.turnId ?? null
        )
      ) {
        return;
      }
      const turnGuard = resolveSessionEventTurnGuard({
        activeTurnId: activeTurnIdRef.current,
        blockedTurnIds: blockedTurnIdsRef.current,
        event,
        isResuming: isResumingRef.current,
        status: statusRef.current,
      });
      if (turnGuard.ignore) {
        return;
      }
      activeTurnIdRef.current = turnGuard.nextActiveTurnId;
      setStreamLifecycle((prev) =>
        nextLifecycleOnSubscriptionEvent({ current: prev, event })
      );
      if (event.type === "connected") {
        connectedChatIdRef.current = activeChatIdRef.current;
      } else if (event.type === "chat_status" && event.status !== "inactive") {
        connectedChatIdRef.current = activeChatIdRef.current;
      } else if (
        !connectedChatIdRef.current &&
        activeChatIdRef.current &&
        (event.type === "ui_message" ||
          event.type === "ui_message_part" ||
          event.type === "ui_message_part_removed" ||
          event.type === "chat_finish")
      ) {
        connectedChatIdRef.current = activeChatIdRef.current;
      }
      const store = useChatStore.getState();
      processSessionEvent(
        event,
        {
          currentModes: store.modes,
          currentModels: store.models,
          currentConfigOptions: store.configOptions,
        },
        {
          onStatusChange: store.setStatus,
          onConnStatusChange: store.setConnStatus,
          onMessageUpsert: applyMessagesImmediate,
          onMessagePartUpdate: applyMessagePartUpdate,
          getMessageById: getMessageByIdWithPending,
          getCommands: () => useChatStore.getState().commands,
          onModesChange: store.setModes,
          onModelsChange: store.setModels,
          onCommandsChange: (cmds) => {
            const normalized = cmds.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              input: cmd.input,
            }));
            store.setCommands(normalized);
          },
          onConfigOptionsChange: store.setConfigOptions,
          onSessionInfoChange: store.setSessionInfo,
          onTerminalOutput: store.appendTerminalOutput,
          onError: (err) => {
            store.setError(err);
            store.setStatus("error");
            activeTurnIdRef.current = null;
            onErrorRef.current?.(err);
          },
          onFinish: (payload) => {
            onFinishRef.current?.(payload);
          },
          onStreamingChange: (wasStreaming, nowStreaming, message) => {
            if (wasStreaming && !nowStreaming && message.role === "assistant") {
              triggerStreamEndHaptic(message.id);
            }
          },
        }
      );
      if (
        event.type === "chat_status" &&
        shouldFinalizeAfterReadyStatus({
          event,
          completedTurnIds: completedTurnIdsRef.current,
        })
      ) {
        finalizeMessagesInStore();
      }
      if (event.type === "chat_finish") {
        rememberCompletedTurnId(
          completedTurnIdsRef.current,
          event.turnId ?? null
        );
        const finalizedMessages = finalizeMessagesInStore();
        if (
          getChatFinishHistoryReloadDecision({
            event,
            messages: finalizedMessages,
          })
        ) {
          loadHistory(true);
        }
      } else if (event.type === "error") {
        finalizeMessagesInStore();
        activeTurnIdRef.current = null;
      }
      if (
        event.type === "chat_status" &&
        event.status === "inactive" &&
        !isResumingRef.current
      ) {
        connectedChatIdRef.current = null;
        activeTurnIdRef.current = null;
        setStreamLifecycle("idle");
        store.setConnStatus("idle");
      }
    },
    [
      applyMessagePartUpdate,
      applyMessagesImmediate,
      finalizeMessagesInStore,
      getMessageByIdWithPending,
      loadHistory,
      triggerStreamEndHaptic,
    ]
  );

  const shouldSubscribe =
    !!activeChatId &&
    !activeChatIsReadOnly &&
    !isChatFailed(activeChatId) &&
    isConfigured;

  useEffect(() => {
    if (!shouldSubscribe) {
      return;
    }
    setStreamLifecycle((prev) => nextLifecycleOnSubscriptionStart(prev));
  }, [shouldSubscribe]);

  const ensureLiveSubscription = useCallback(async () => {
    const targetChatId = activeChatIdRef.current;
    if (!targetChatId || activeChatIsReadOnly) {
      return false;
    }
    if (
      statusRef.current === "inactive" ||
      streamLifecycleRef.current === "recovering" ||
      connStatusRef.current === "error"
    ) {
      return false;
    }
    if (
      isLiveSubscriptionReady({
        activeChatId: targetChatId,
        connectedChatId: connectedChatIdRef.current,
        streamLifecycle: streamLifecycleRef.current,
      })
    ) {
      return true;
    }
    const deadline = Date.now() + LIVE_SUBSCRIPTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(LIVE_SUBSCRIPTION_POLL_MS);
      if (activeChatIdRef.current !== targetChatId || activeChatIsReadOnly) {
        return false;
      }
      if (
        isLiveSubscriptionReady({
          activeChatId: targetChatId,
          connectedChatId: connectedChatIdRef.current,
          streamLifecycle: streamLifecycleRef.current,
        })
      ) {
        return true;
      }
    }
    return false;
  }, [activeChatIsReadOnly]);

  trpc.onSessionEvents.useSubscription(
    { chatId: activeChatId || "", subscriptionEpoch },
    {
      enabled: shouldSubscribe,
      onData(data: unknown) {
        const parsed = parseBroadcastEventClientSafe(data);
        if (!parsed.ok) {
          if (parsed.kind === "unknown_event") {
            // Silently ignore unknown event types (matches web behavior).
            return;
          }
          console.warn("[Native] Dropped invalid session event", {
            error: parsed.error,
          });
          return;
        }
        handleSessionEvent(parsed.value);
      },
      onError(err) {
        const store = useChatStore.getState();
        const message =
          typeof err?.message === "string" ? err.message : "Subscription error";

        if (message.includes("Chat not found") && activeChatId) {
          // Mark this chat as failed to prevent infinite re-subscription
          store.markChatFailed(activeChatId);
          store.setActiveChatId(null);
          store.setConnStatus("idle");
          store.setStatus("error");
          store.setError(
            "Chat not found. The session may have expired. Please start a new session."
          );
          onErrorRef.current?.(message);
          return;
        }

        setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
        store.setConnStatus("connecting");
        store.setStatus("connecting");
        store.setError(message);
        onErrorRef.current?.(message);
      },
    }
  );

  const sendMessageWithInput = async (
    input?: SendMessageInput,
    attachments: Attachment[] = []
  ) => {
    if (!activeChatId) {
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

    if (activeTurnIdRef.current && !isChatBusyStatus(statusRef.current)) {
      activeTurnIdRef.current = null;
    }
    const hasLiveSubscription = await ensureLiveSubscription();
    if (!hasLiveSubscription) {
      const message = "Realtime stream is not connected yet. Please retry.";
      store.setError(message);
      return false;
    }
    if (streamLifecycleRef.current === "idle") {
      setStreamLifecycle("bootstrapping");
      store.setConnStatus("connecting");
    }
    const previousStatus = statusRef.current;
    store.setStatus("submitted");

    try {
      const payload = buildSendMessagePayload(
        normalized.text,
        normalized.files ?? []
      );
      const res = await sendMessageMutation.mutateAsync({
        chatId: activeChatId,
        ...payload,
      });
      store.setError(null);
      activeTurnIdRef.current = res.turnId ?? null;
      if (res.turnId) {
        blockedTurnIdsRef.current.delete(res.turnId);
      }
      return true;
    } catch (e) {
      const err = e as Error;
      if (!shouldRollbackSendMessageFailure(statusRef.current)) {
        return true;
      }
      if (readTrpcErrorCode(e) === "CONFLICT") {
        setStreamLifecycle((prev) =>
          prev === "idle" ? "bootstrapping" : prev
        );
        if (connStatusRef.current === "idle") {
          store.setConnStatus("connecting");
        }
      }
      store.setError(err.message);
      store.setStatus(previousStatus);
      onErrorRef.current?.(err.message);
      return false;
    }
  };

  const setMode = async (modeId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
      if (store.modes) {
        store.setModes({ ...store.modes, currentModeId: modeId });
      }
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      onErrorRef.current?.(err.message);
    }
  };

  const setModel = async (modelId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
      if (store.models) {
        store.setModels({ ...store.models, currentModelId: modelId });
      }
    } catch (e) {
      const err = e as Error;
      const message = err?.message || "Failed to set model";
      const normalized = message.toLowerCase();
      if (
        normalized.includes("model switching") ||
        normalized.includes("method not found")
      ) {
        store.setSupportsModelSwitching(false);
      }
      store.setError(message);
      onErrorRef.current?.(message);
    }
  };

  const setConfigOption = async (configId: string, value: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      const result = await setConfigOptionMutation.mutateAsync({
        chatId: activeChatId,
        configId,
        value,
      });
      const nextConfigOptions = Array.isArray(result?.configOptions)
        ? result.configOptions
        : store.configOptions.map((option) =>
            option.id === configId ? { ...option, currentValue: value } : option
          );
      store.setConfigOptions(nextConfigOptions);
    } catch (e) {
      const err = e as Error;
      const message = err?.message || "Failed to set config option";
      store.setError(message);
      onErrorRef.current?.(message);
    }
  };

  const cancelPrompt = async () => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    const previousStatus = store.status;
    store.setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      store.setStatus(previousStatus);
      onErrorRef.current?.(err.message);
    }
  };

  const respondToPermission = async (requestId: string, decision: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await respondToPermissionMutation.mutateAsync({
        chatId: activeChatId,
        requestId,
        decision,
      });
      store.setPendingPermission(null);
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      onErrorRef.current?.(err.message);
    }
  };

  const addToolApprovalResponse = async (response: ToolApprovalResponse) => {
    const decision =
      response.reason ?? (response.approved ? "allow" : "reject");
    await respondToPermission(response.id, decision);
  };

  const stopSession = async () => {
    if (!activeChatId) {
      return;
    }
    await stopSessionMutation.mutateAsync({ chatId: activeChatId });
    const store = useChatStore.getState();
    rememberBlockedTurnId(blockedTurnIdsRef.current, activeTurnIdRef.current);
    activeTurnIdRef.current = null;
    connectedChatIdRef.current = null;
    setStreamLifecycle("idle");
    store.setConnStatus("idle");
    store.setStatus("inactive");
  };

  const deleteSession = async (chatId?: string) => {
    const targetChatId = chatId ?? activeChatId;
    if (!targetChatId) {
      return false;
    }
    return await deleteSessionById(targetChatId);
  };

  const resumeSession = async (chatId: string) => {
    if (resumePromiseRef.current) {
      return await resumePromiseRef.current;
    }

    const store = useChatStore.getState();
    const resumeOperation = (async () => {
      isResumingRef.current = true;
      activeTurnIdRef.current = null;
      blockedTurnIdsRef.current = new Set();
      completedTurnIdsRef.current = new Set();
      connectedChatIdRef.current = null;
      setStreamLifecycle("bootstrapping");
      store.setConnStatus("connecting");
      store.setStatus("connecting");
      await utils.getSessionState.cancel({ chatId });
      const res = await resumeSessionMutation.mutateAsync({ chatId });
      const syncPlan = deriveResumeSessionSyncPlan(res);
      setSubscriptionEpoch((current) => current + 1);
      await utils.getSessionState.invalidate({ chatId });
      if (syncPlan.modes !== undefined) {
        store.setModes(syncPlan.modes ?? null);
      }
      if (syncPlan.models !== undefined) {
        store.setModels(syncPlan.models ?? null);
      }
      if (syncPlan.supportsModelSwitching !== undefined) {
        store.setSupportsModelSwitching(syncPlan.supportsModelSwitching);
      }
      if (res?.promptCapabilities !== undefined) {
        store.setPromptCapabilities(res.promptCapabilities);
      }
      store.setMessages([]);
      store.setPendingPermission(null);
      store.setConnStatus("connected");
      store.setStatus("ready");
      isResumingRef.current = false;
      await loadHistory(true);
      return res;
    })();

    resumePromiseRef.current = resumeOperation;

    try {
      return await resumeOperation;
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
      store.setConnStatus("connecting");
      store.setStatus("connecting");
      onErrorRef.current?.(err.message);
      throw e;
    } finally {
      if (isResumingRef.current) {
        isResumingRef.current = false;
      }
      if (resumePromiseRef.current === resumeOperation) {
        resumePromiseRef.current = null;
      }
    }
  };

  const resumeStream = async () => {
    if (!activeChatId) {
      return;
    }
    await resumeSession(activeChatId);
  };

  const clearError = () => {
    useChatStore.getState().setError(null);
  };

  return {
    // State
    id: activeChatId,
    status,
    connStatus,
    pendingPermission,
    error,

    // Session state
    modes,
    models,
    supportsModelSwitching,
    commands,
    configOptions,
    sessionInfo,
    promptCapabilities,
    agentInfo,
    loadSessionSupported,

    // Actions
    sendMessage: sendMessageWithInput,
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
    setMessages: useChatStore.getState().setMessages,
  };
}
