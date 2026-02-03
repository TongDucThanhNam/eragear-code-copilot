/**
 * useChat Hook (Native)
 *
 * Native-specific adapter for the shared chat core.
 * Preserves haptics integration and Zustand store integration.
 */

import type { BroadcastEvent, UIMessage, UseChatOptions } from "@repo/shared";
import {
  applySessionState,
  findPendingPermission,
  processSessionEvent,
} from "@repo/shared";
import { NotificationFeedbackType, notificationAsync } from "expo-haptics";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { type Attachment, buildSendMessagePayload } from "@/lib/attachments";
import { trpc } from "@/lib/trpc";
import { useChatStore } from "@/store/chat-store";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Hook Implementation
// ============================================================================

export function useChat(options: UseChatOptions = {}) {
  const { onFinish, onError } = options;

  // Select only what we need for the hook's internal logic (subscription key)
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
      promptCapabilities: state.promptCapabilities,
      agentInfo: state.agentInfo,
      loadSessionSupported: state.loadSessionSupported,
      pendingPermission: state.pendingPermission,
      error: state.error,
      isChatFailed: state.isChatFailed,
      getMessageById: state.getMessageById,
    }))
  );

  const utils = trpc.useUtils();
  const hapticTriggeredRef = useRef<Set<string>>(new Set());
  const onFinishRef = useRef(onFinish);
  const onErrorRef = useRef(onError);
  const isResumingRef = useRef(false);
  const pendingMessagesRef = useRef<Map<string, UIMessage>>(new Map());
  const messageFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const STREAM_FLUSH_MS = 50;

  // Keep refs in sync
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    return () => {
      if (messageFlushTimerRef.current) {
        clearTimeout(messageFlushTimerRef.current);
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChatId is intentional - reset haptics on chat change
  useEffect(() => {
    hapticTriggeredRef.current = new Set();
    pendingMessagesRef.current.clear();
    if (messageFlushTimerRef.current) {
      clearTimeout(messageFlushTimerRef.current);
      messageFlushTimerRef.current = null;
    }
  }, [activeChatId]);

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

  // Mutations
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const respondToPermissionMutation =
    trpc.respondToPermissionRequest.useMutation();
  const { deleteSession: deleteSessionById } = useDeleteSession();

  // Snapshot state (modes/models/commands) on connect or reconnect
  const sessionStateQuery = trpc.getSessionState.useQuery(
    { chatId: activeChatId || "" },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        connStatus === "connecting" &&
        !isResumingRef.current,
      retry: false,
      staleTime: 0,
    }
  );

  const sessionMessagesQuery = trpc.getSessionMessages.useQuery(
    { chatId: activeChatId || "" },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        connStatus === "connecting" &&
        !isResumingRef.current,
      retry: false,
      staleTime: 0,
    }
  );

  const applyStateToStore = useCallback(
    (data: NonNullable<typeof sessionStateQuery.data>) => {
      const store = useChatStore.getState();

      applySessionState(data, {
        onStatusChange: store.setStatus,
        onModesChange: store.setModes,
        onModelsChange: store.setModels,
        onSupportsModelSwitchingChange: store.setSupportsModelSwitching,
        onCommandsChange: (cmds) => {
          const normalized = cmds.map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            input: cmd.input,
          }));
          store.setCommands(normalized);
        },
        onPromptCapabilitiesChange: store.setPromptCapabilities,
        onLoadSessionSupportedChange: store.setLoadSessionSupported,
        onAgentInfoChange: store.setAgentInfo,
        onConnStatusChange: store.setConnStatus,
      });
    },
    []
  );

  useEffect(() => {
    const data = sessionStateQuery.data;
    if (!data || connStatus !== "connecting") {
      return;
    }

    const store = useChatStore.getState();
    const history = sessionMessagesQuery.data;
    if (Array.isArray(history)) {
      store.setMessages(history);
      store.setPendingPermission(findPendingPermission(history));
    }

    if (data.status === "stopped") {
      if (data.loadSessionSupported !== undefined) {
        store.setLoadSessionSupported(data.loadSessionSupported);
      }
      if (data.agentInfo !== undefined) {
        store.setAgentInfo(data.agentInfo);
      }
      applyStateToStore(data);
      return;
    }

    applyStateToStore(data);
  }, [
    sessionStateQuery.data,
    sessionMessagesQuery.data,
    connStatus,
    applyStateToStore,
  ]);

  const syncPendingPermission = useCallback(() => {
    const store = useChatStore.getState();
    const nextPending = findPendingPermission(store.getMessagesForPermission());
    store.setPendingPermission(nextPending);
  }, []);

  const isStreamingUiMessage = useCallback((message: UIMessage) => {
    return message.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.state === "streaming";
      }
      if (part.type.startsWith("tool-")) {
        return (
          part.state === "input-streaming" ||
          part.state === "input-available" ||
          part.state === "approval-requested" ||
          part.state === "approval-responded"
        );
      }
      return false;
    });
  }, []);

  const flushMessages = useCallback(() => {
    const pending = pendingMessagesRef.current;
    if (pending.size === 0) {
      return;
    }
    for (const message of pending.values()) {
      useChatStore.getState().upsertMessage(message);
    }
    pending.clear();
    syncPendingPermission();
  }, [syncPendingPermission]);

  const applyMessagesImmediate = useCallback(
    (message: UIMessage) => {
      if (messageFlushTimerRef.current) {
        clearTimeout(messageFlushTimerRef.current);
        messageFlushTimerRef.current = null;
      }
      pendingMessagesRef.current.set(message.id, message);
      flushMessages();
    },
    [flushMessages]
  );

  const scheduleMessagesUpdate = useCallback(
    (message: UIMessage) => {
      pendingMessagesRef.current.set(message.id, message);
      if (messageFlushTimerRef.current) {
        return;
      }
      messageFlushTimerRef.current = setTimeout(() => {
        messageFlushTimerRef.current = null;
        flushMessages();
      }, STREAM_FLUSH_MS);
    },
    [flushMessages]
  );

  // Subscription Handler - uses shared core logic
  const handleSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      const store = useChatStore.getState();
      const currentModes = store.modes;
      const shouldBatch =
        event.type === "ui_message" && isStreamingUiMessage(event.message);
      const onMessageUpsert = shouldBatch
        ? scheduleMessagesUpdate
        : applyMessagesImmediate;

      processSessionEvent(event, [], currentModes, {
        onStatusChange: store.setStatus,
        onConnStatusChange: store.setConnStatus,
        onMessageUpsert,
        getMessageById,
        onModesChange: store.setModes,
        onCommandsChange: (cmds) => {
          const normalized = cmds.map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            input: cmd.input,
          }));
          store.setCommands(normalized);
        },
        onTerminalOutput: store.appendTerminalOutput,
        onError: (err) => {
          store.setError(err);
          store.setStatus("error");
          onErrorRef.current?.(err);
        },
        onFinish: (payload) => {
          onFinishRef.current?.(payload);
        },
        onStreamingChange: (wasStreaming, nowStreaming, message) => {
          // Trigger haptic when streaming ends
          if (wasStreaming && !nowStreaming && message.role === "assistant") {
            triggerStreamEndHaptic(message.id);
          }
        },
      });
    },
    [
      isStreamingUiMessage,
      applyMessagesImmediate,
      scheduleMessagesUpdate,
      syncPendingPermission,
      triggerStreamEndHaptic,
      getMessageById,
    ]
  );

  // Check if this chat has already failed (prevents infinite loop)
  const shouldSubscribe =
    !!activeChatId &&
    !activeChatIsReadOnly &&
    !isChatFailed(activeChatId) &&
    connStatus === "connected" &&
    isConfigured;

  // Subscription
  trpc.onSessionEvents.useSubscription(
    { chatId: activeChatId || "" },
    {
      enabled: shouldSubscribe,
      onData: (data) => handleSessionEvent(data as BroadcastEvent),
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
          store.setStatus("error");
          store.setError(
            "Chat not found. The session may have expired. Please start a new session."
          );
          onErrorRef.current?.(message);
          return;
        }

        store.setConnStatus("error");
        store.setStatus("error");
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

    store.setStatus("submitted");

    try {
      const payload = buildSendMessagePayload(
        normalized.text,
        normalized.files ?? []
      );
      await sendMessageMutation.mutateAsync({
        chatId: activeChatId,
        ...payload,
      });
      return true;
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      store.setStatus("error");
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
    const store = useChatStore.getState();
    try {
      isResumingRef.current = true;
      store.setConnStatus("connecting");
      store.setStatus("connecting");
      await utils.getSessionState.cancel({ chatId });
      const res = await resumeSessionMutation.mutateAsync({ chatId });
      await utils.getSessionState.invalidate({ chatId });
      await utils.getSessionMessages.invalidate({ chatId });
      const [state, history] = await Promise.all([
        utils.getSessionState.fetch({ chatId }),
        utils.getSessionMessages.fetch({ chatId }),
      ]);
      if (Array.isArray(history)) {
        store.setMessages(history);
        store.setPendingPermission(findPendingPermission(history));
      }
      if (state.status === "stopped") {
        if (state.agentInfo !== undefined) {
          store.setAgentInfo(state.agentInfo);
        }
        if (state.loadSessionSupported !== undefined) {
          store.setLoadSessionSupported(state.loadSessionSupported);
        }
        applyStateToStore(state);
        isResumingRef.current = false;
        return res;
      }
      applyStateToStore(state);
      if (res?.promptCapabilities !== undefined) {
        store.setPromptCapabilities(res.promptCapabilities);
      }
      isResumingRef.current = false;
      return res;
    } catch (e) {
      const err = e as Error;
      store.setError(err.message);
      store.setConnStatus("error");
      store.setStatus("error");
      onErrorRef.current?.(err.message);
      isResumingRef.current = false;
      throw e;
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
    id: activeChatId, // the active chat/session ID
    status, //
    connStatus,
    pendingPermission,
    error,

    // Session state
    modes,
    models,
    supportsModelSwitching,
    commands,
    promptCapabilities,
    agentInfo,
    loadSessionSupported,

    // Actions
    sendMessage: sendMessageWithInput,
    setMode,
    setModel,
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
