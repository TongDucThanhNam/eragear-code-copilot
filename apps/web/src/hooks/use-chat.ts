/**
 * useChat Hook (Web)
 *
 * Web-specific adapter for the shared chat core.
 * Wraps tRPC mutations + subscription with React state management.
 */
import type {
  AgentInfo,
  AvailableCommand,
  BroadcastEvent,
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  PromptCapabilities,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
  SessionStateData,
  UIMessage,
} from "@repo/shared";
import {
  applySessionState,
  findPendingPermission,
  isChatBusyStatus,
  processSessionEvent,
} from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  getChatMessageStateSnapshot,
  getChatTerminalOutputsSnapshot,
  useChatMessages,
  useChatStreamStore,
  useChatTerminalOutputs,
} from "@/store/chat-stream-store";
import { useFileStore } from "@/store/file-store";
import {
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  type StreamLifecycle,
} from "./use-chat-connection.machine";
import { useChatActions } from "./use-chat-actions";
import { useChatDeltaRecovery } from "./use-chat-delta-recovery";
import { useChatFallback } from "./use-chat-fallback";
import { useChatHistory } from "./use-chat-history";
import {
  applyMessageDeltasIntoState,
  type MessageDeltaChunk,
  type MessageState,
  replaceMessagesState,
  upsertMessageIntoState,
} from "./use-chat-message-state";
import {
  normalizeMessage,
  normalizeMessages,
  normalizeSessionStateData,
  parseBroadcastEvent,
  shouldLogChatStreamDebug,
} from "./use-chat-normalize";
import { describeDeltaTarget, logChatStreamDebug } from "./use-chat-stream-debug";
import type { UseChatOptions, UseChatResult } from "./use-chat.types";
const INVALID_EVENT_TOAST_COOLDOWN_MS = 5000;
export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { chatId, readOnly = false, onFinish, onError } = options;
  const utils = trpc.useUtils();
  // Core state
  const [status, setStatus] = useState<ChatStatus>(
    chatId && !readOnly ? "connecting" : "inactive"
  );
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(
    chatId && !readOnly ? "connecting" : "idle"
  );
  const [streamLifecycle, setStreamLifecycle] = useState<StreamLifecycle>(
    nextLifecycleOnChatIdChange({
      hasChatId: Boolean(chatId),
      readOnly,
    })
  );
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Session state
  const [modes, setModes] = useState<SessionModeState | null>(null);
  const [models, setModels] = useState<SessionModelState | null>(null);
  const [supportsModelSwitching, setSupportsModelSwitching] = useState(false);
  const [commands, setCommands] = useState<AvailableCommand[]>([]);
  const [configOptions, setConfigOptions] = useState<SessionConfigOption[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [promptCapabilities, setPromptCapabilities] =
    useState<PromptCapabilities | null>(null);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loadSessionSupported, setLoadSessionSupported] = useState<
    boolean | undefined
  >(undefined);
  // Refs
  const messageStateRef = useRef<MessageState>(
    getChatMessageStateSnapshot(chatId ?? null)
  );
  const terminalOutputsRef = useRef<Record<string, string>>(
    getChatTerminalOutputsSnapshot(chatId ?? null)
  );
  const modesRef = useRef<SessionModeState | null>(null);
  const commandsRef = useRef<AvailableCommand[]>(commands);
  const isResumingRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(chatId ?? null);
  const previousChatIdRef = useRef<string | null>(chatId ?? null);
  const previousStreamLifecycleRef = useRef<StreamLifecycle>(streamLifecycle);
  const statusRef = useRef<ChatStatus>(status);
  const invalidEventToastAtRef = useRef(0);
  const hasLocalModeOverrideRef = useRef(false);
  const hasLocalModelOverrideRef = useRef(false);
  const hasLocalConfigOverrideRef = useRef(false);
  const pendingDeltaOrderRef = useRef<string[]>([]);
  const pendingDeltaMapRef = useRef<Map<string, MessageDeltaChunk>>(new Map());
  const pendingDeltaFlushFrameRef = useRef<number | null>(null);
  const messages = useChatMessages(chatId);
  const terminalOutputs = useChatTerminalOutputs(chatId);
  // Keep refs in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    activeChatIdRef.current = chatId ?? null;
  }, [chatId]);
  useEffect(() => {
    modesRef.current = modes;
  }, [modes]);
  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);
  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!activeChatId) {
      messageStateRef.current = getChatMessageStateSnapshot(null);
      return;
    }
    messageStateRef.current = useChatStreamStore
      .getState()
      .getMessageState(activeChatId);
  }, [chatId, messages]);
  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!activeChatId) {
      terminalOutputsRef.current = getChatTerminalOutputsSnapshot(null);
      return;
    }
    terminalOutputsRef.current = useChatStreamStore
      .getState()
      .getTerminalOutputs(activeChatId);
  }, [chatId, terminalOutputs]);
  const updateMessageState = useCallback(
    (updater: (prev: MessageState) => MessageState) => {
      const activeChatId = activeChatIdRef.current;
      if (!activeChatId) {
        const next = updater(messageStateRef.current);
        messageStateRef.current = next;
        return;
      }
      const next = useChatStreamStore
        .getState()
        .updateMessageState(activeChatId, updater);
      messageStateRef.current = next;
    },
    []
  );

  const clearPendingDeltas = useCallback(() => {
    if (pendingDeltaFlushFrameRef.current !== null) {
      if (
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(pendingDeltaFlushFrameRef.current);
      }
      clearTimeout(pendingDeltaFlushFrameRef.current);
      pendingDeltaFlushFrameRef.current = null;
    }
    pendingDeltaOrderRef.current = [];
    pendingDeltaMapRef.current.clear();
  }, []);

  const flushPendingDeltas = useCallback(() => {
    if (pendingDeltaOrderRef.current.length === 0) {
      return;
    }
    const deltas = pendingDeltaOrderRef.current
      .map((key) => pendingDeltaMapRef.current.get(key))
      .filter((delta): delta is MessageDeltaChunk => Boolean(delta));
    pendingDeltaOrderRef.current = [];
    pendingDeltaMapRef.current.clear();
    updateMessageState((prev) => applyMessageDeltasIntoState(prev, deltas));
  }, [updateMessageState]);

  const scheduleDeltaFlush = useCallback(() => {
    if (pendingDeltaFlushFrameRef.current !== null) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      pendingDeltaFlushFrameRef.current = window.requestAnimationFrame(() => {
        pendingDeltaFlushFrameRef.current = null;
        flushPendingDeltas();
      });
      return;
    }
    pendingDeltaFlushFrameRef.current = setTimeout(() => {
      pendingDeltaFlushFrameRef.current = null;
      flushPendingDeltas();
    }, 16) as unknown as number;
  }, [flushPendingDeltas]);

  const enqueueDeltaChunk = useCallback(
    (event: Extract<BroadcastEvent, { type: "ui_message_delta" }>) => {
      if (!event.delta) {
        return;
      }
      const key = `${event.messageId}:${event.partIndex}`;
      const existing = pendingDeltaMapRef.current.get(key);
      if (existing) {
        existing.delta += event.delta;
      } else {
        pendingDeltaMapRef.current.set(key, {
          messageId: event.messageId,
          partIndex: event.partIndex,
          delta: event.delta,
        });
        pendingDeltaOrderRef.current.push(key);
      }
      scheduleDeltaFlush();
    },
    [scheduleDeltaFlush]
  );
  // Upsert single message
  const upsertMessage = useCallback(
    (next: UIMessage) => {
      updateMessageState((prev) => upsertMessageIntoState(prev, next));
    },
    [updateMessageState]
  );
  const setMessages = useCallback((nextMessages: UIMessage[]) => {
    const nextState = replaceMessagesState(nextMessages);
    const activeChatId = activeChatIdRef.current;
    if (activeChatId) {
      useChatStreamStore
        .getState()
        .updateMessageState(activeChatId, () => nextState);
    }
    messageStateRef.current = nextState;
    setPendingPermission(findPendingPermission(nextState.byId.values()));
  }, []);
  const isActiveChat = useCallback(
    (targetChatId: string) => activeChatIdRef.current === targetChatId,
    []
  );
  const {
    clearPending: clearPendingUserMessageFallback,
    clearAll: clearAllPendingUserMessageFallbacks,
    flushAll: flushPendingUserMessageFallbacks,
    reset: resetPendingUserMessageFallbackState,
    schedule: schedulePendingUserMessageFallback,
  } = useChatFallback({
    readOnly,
    activeChatIdRef,
    messageStateRef,
    updateMessageState,
    upsertMessageIntoState,
    normalizeMessage,
    setError,
    onError,
    fetchMessageById: ({ chatId: targetChatId, messageId, signal }) =>
      utils.getSessionMessageById.fetch(
        { chatId: targetChatId, messageId },
        { trpc: { signal } }
      ),
  });
  const {
    clearHistoryWindow,
    hasMoreHistory,
    invalidateHistoryLoads,
    isLoadingOlderHistory,
    loadHistory,
    loadOlderHistory,
    markHistoryNotApplied,
    refreshHistory,
    resetHistoryState,
  } = useChatHistory({
    chatId,
    connStatus,
    readOnly,
    isResumingRef,
    isActiveChat,
    messageStateRef,
    setPendingPermission,
    setError,
    onError,
    updateMessageState,
    normalizeMessages,
    fetchHistoryPage: (input) => utils.getSessionMessagesPage.fetch(input),
  });
  const { recoverMissingDelta, resetDeltaRecoveryState } = useChatDeltaRecovery({
    readOnly,
    activeChatIdRef,
    messageStateRef,
    updateMessageState,
    upsertMessageIntoState,
    normalizeMessage,
    fetchMessageById: ({ chatId: targetChatId, messageId, signal }) =>
      utils.getSessionMessageById.fetch(
        { chatId: targetChatId, messageId },
        { trpc: { signal } }
      ),
    reloadHistory: async () => {
      await loadHistory(true);
    },
  });
  // Apply session state helper
  const restoreSessionState = useCallback((data: SessionStateData) => {
    applySessionState(data, {
      onStatusChange: setStatus,
      onModesChange: (m) => {
        setModes(m);
        modesRef.current = m;
      },
      onModelsChange: setModels,
      onSupportsModelSwitchingChange: setSupportsModelSwitching,
      getCommands: () => commandsRef.current,
      onCommandsChange: (nextCommands) => {
        commandsRef.current = nextCommands;
        setCommands(nextCommands);
      },
      onConfigOptionsChange: setConfigOptions,
      onSessionInfoChange: setSessionInfo,
      onPromptCapabilitiesChange: setPromptCapabilities,
      onLoadSessionSupportedChange: setLoadSessionSupported,
      onAgentInfoChange: setAgentInfo,
      onConnStatusChange: setConnStatus,
    });
  }, []);
  // Session state query
  const { data: sessionState } = trpc.getSessionState.useQuery(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && !readOnly && streamLifecycle !== "idle",
      retry: 2,
      staleTime: 0,
    }
  );
  useEffect(() => {
    const nextLifecycle = nextLifecycleOnChatIdChange({
      hasChatId: Boolean(chatId),
      readOnly,
    });
    const streamStore = useChatStreamStore.getState();
    const previousChatId = previousChatIdRef.current;
    const nextChatId = chatId ?? null;
    if (previousChatId && previousChatId !== nextChatId) {
      streamStore.clearChat(previousChatId);
    }
    previousChatIdRef.current = nextChatId;
    clearPendingDeltas();
    hasLocalModeOverrideRef.current = false;
    hasLocalModelOverrideRef.current = false;
    hasLocalConfigOverrideRef.current = false;
    if (chatId) {
      messageStateRef.current = streamStore.getMessageState(chatId);
      terminalOutputsRef.current = streamStore.getTerminalOutputs(chatId);
    } else {
      messageStateRef.current = getChatMessageStateSnapshot(null);
      terminalOutputsRef.current = getChatTerminalOutputsSnapshot(null);
    }
    resetPendingUserMessageFallbackState();
    resetHistoryState();
    resetDeltaRecoveryState();
    setPendingPermission(null);
    setError(null);
    setModes(null);
    modesRef.current = null;
    setModels(null);
    setSupportsModelSwitching(false);
    setCommands([]);
    commandsRef.current = [];
    setConfigOptions([]);
    setSessionInfo(null);
    setPromptCapabilities(null);
    setAgentInfo(null);
    setLoadSessionSupported(undefined);
    isResumingRef.current = false;
    activeTurnIdRef.current = null;
    setStreamLifecycle(nextLifecycle);
    if (nextLifecycle === "idle") {
      setConnStatus("idle");
      setStatus("inactive");
    } else {
      setConnStatus("connecting");
      setStatus("connecting");
    }
  }, [
    chatId,
    clearPendingDeltas,
    readOnly,
    resetHistoryState,
    resetDeltaRecoveryState,
    resetPendingUserMessageFallbackState,
  ]);

  useEffect(() => {
    return () => {
      clearPendingDeltas();
    };
  }, [clearPendingDeltas]);

  useEffect(() => {
    if (connStatus === "connecting") {
      markHistoryNotApplied();
    }
  }, [connStatus, markHistoryNotApplied]);

  // Load stored history once, merging pages by message.id
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const previous = previousStreamLifecycleRef.current;
    if (previous === "recovering" && streamLifecycle === "live") {
      loadHistory(true);
    }
    previousStreamLifecycleRef.current = streamLifecycle;
  }, [loadHistory, streamLifecycle]);

  // Apply session state when loaded
  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!(activeChatId && sessionState) || connStatus !== "connecting") {
      return;
    }
    const normalizedSessionState = normalizeSessionStateData(sessionState);
    const stateToRestore: SessionStateData = {
      ...normalizedSessionState,
      ...(hasLocalModeOverrideRef.current ? { modes: undefined } : {}),
      ...(hasLocalModelOverrideRef.current ? { models: undefined } : {}),
      ...(hasLocalConfigOverrideRef.current
        ? { configOptions: undefined }
        : {}),
    };
    if (isResumingRef.current && normalizedSessionState.status === "stopped") {
      return;
    }
    if (stateToRestore.status === "stopped") {
      setLoadSessionSupported(stateToRestore.loadSessionSupported ?? false);
      restoreSessionState(stateToRestore);
      isResumingRef.current = false;
      return;
    }
    restoreSessionState(stateToRestore);
    isResumingRef.current = false;
  }, [chatId, sessionState, connStatus, restoreSessionState]);
  const isTurnMatched = useCallback((turnId?: string) => {
    if (!turnId) {
      return true;
    }
    const activeTurnId = activeTurnIdRef.current;
    if (!activeTurnId) {
      activeTurnIdRef.current = turnId;
      return true;
    }
    return activeTurnId === turnId;
  }, []);
  // Event handler
  const handleSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      if (shouldLogChatStreamDebug()) {
        logChatStreamDebug({
          event,
          activeChatId: activeChatIdRef.current,
          state: messageStateRef.current,
        });
      }
      if (event.type === "ui_message") {
        clearPendingUserMessageFallback(event.message.id);
      }
      if (event.type === "chat_finish") {
        flushPendingUserMessageFallbacks();
      }
      if (event.type === "error") {
        clearAllPendingUserMessageFallbacks();
      }
      if (event.type === "chat_finish" && !isTurnMatched(event.turnId)) {
        return;
      }
      setStreamLifecycle((prev) =>
        nextLifecycleOnSubscriptionEvent({ current: prev, event })
      );
      if (event.type === "chat_status") {
        setConnStatus("connected");
      }
      if (event.type === "ui_message_delta") {
        const deltaTarget = describeDeltaTarget({
          event,
          state: messageStateRef.current,
        });
        if (!deltaTarget.baseMessage) {
          recoverMissingDelta(event.messageId, "message_not_found");
          return;
        }
        if (!deltaTarget.hasPart) {
          recoverMissingDelta(event.messageId, "part_not_found");
          return;
        }
        enqueueDeltaChunk(event);
        return;
      }
      flushPendingDeltas();
      processSessionEvent(
        event,
        { currentModes: modesRef.current },
        {
          onStatusChange: setStatus,
          onConnStatusChange: setConnStatus,
          onMessageUpsert: (message) => {
            const normalizedMessage = normalizeMessage(message);
            updateMessageState((prev) =>
              upsertMessageIntoState(prev, normalizedMessage)
            );
          },
          getMessageById: (messageId) =>
            messageStateRef.current.byId.get(messageId),
          getMessagesForPermission: () => messageStateRef.current.byId.values(),
          onPendingPermissionChange: setPendingPermission,
          onModesChange: (m) => {
            setModes(m);
            modesRef.current = m;
          },
          getCommands: () => commandsRef.current,
          onCommandsChange: (nextCommands) => {
            commandsRef.current = nextCommands;
            setCommands(nextCommands);
          },
          onConfigOptionsChange: setConfigOptions,
          onSessionInfoChange: setSessionInfo,
          onTerminalOutput: (terminalId, data) => {
            const activeChatId = activeChatIdRef.current;
            if (!activeChatId) {
              return;
            }
            terminalOutputsRef.current = useChatStreamStore
              .getState()
              .appendTerminalOutput(activeChatId, terminalId, data);
          },
          onFileModified: (filePath) => {
            useFileStore.getState().upsertFile(filePath);
          },
          onError: (err) => {
            setError(err);
            setStatus("error");
            onError?.(err);
          },
          onFinish,
        }
      );
      if (
        event.type === "chat_finish" &&
        messageStateRef.current.order.length === 0
      ) {
        loadHistory(true);
      }
      if (event.type === "chat_finish") {
        if (
          event.turnId &&
          activeTurnIdRef.current &&
          activeTurnIdRef.current === event.turnId
        ) {
          activeTurnIdRef.current = null;
        }
      }
      if (
        event.type === "chat_status" &&
        event.status === "ready" &&
        event.turnId &&
        activeTurnIdRef.current === event.turnId
      ) {
        activeTurnIdRef.current = null;
      }
      if (event.type === "error") {
        activeTurnIdRef.current = null;
      }
    },
    [
      clearAllPendingUserMessageFallbacks,
      clearPendingUserMessageFallback,
      enqueueDeltaChunk,
      flushPendingDeltas,
      flushPendingUserMessageFallbacks,
      isTurnMatched,
      loadHistory,
      onFinish,
      onError,
      recoverMissingDelta,
      updateMessageState,
    ]
  );
  // Subscription
  const subscriptionEnabled =
    !!chatId && !readOnly && streamLifecycle !== "idle";
  useEffect(() => {
    if (!subscriptionEnabled) {
      return;
    }
    setStreamLifecycle((prev) => nextLifecycleOnSubscriptionStart(prev));
  }, [subscriptionEnabled]);
  trpc.onSessionEvents.useSubscription(
    { chatId: chatId || "" },
    {
      enabled: subscriptionEnabled,
      onData(rawEvent: unknown) {
        try {
          const event = parseBroadcastEvent(rawEvent);
          handleSessionEvent(event);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Received invalid chat event payload";
          console.warn("[Client] Dropped invalid session event", {
            error: message,
          });
          setError(message);
          const now = Date.now();
          if (
            now - invalidEventToastAtRef.current >=
            INVALID_EVENT_TOAST_COOLDOWN_MS
          ) {
            invalidEventToastAtRef.current = now;
            toast.warning("Dropped malformed ACP event. Stream keeps running.");
          }
        }
      },
      onError(err) {
        console.error("[Client] Subscription error:", err);
        clearPendingDeltas();
        clearAllPendingUserMessageFallbacks();
        setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
        setConnStatus("connecting");
        setError(err.message);
        setStatus("error");
      },
    }
  );
  const {
    sendMessage,
    cancelPrompt,
    setMode,
    setModel,
    setConfigOption,
    respondToPermission,
    stopSession,
    resumeSession,
    isSending,
    isCancelling,
    isResuming,
  } = useChatActions({
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
    onLocalConfigOptionMutated: () => {
      hasLocalConfigOverrideRef.current = true;
    },
    onLocalModeMutated: () => {
      hasLocalModeOverrideRef.current = true;
    },
    onLocalModelMutated: () => {
      hasLocalModelOverrideRef.current = true;
    },
    schedulePendingUserMessageFallback,
    invalidateHistoryLoads,
    clearHistoryWindow,
    loadHistory,
  });
  // Derived state
  const isStreaming = isChatBusyStatus(status);
  return {
    // State
    messages,
    status,
    connStatus,
    isStreaming,
    pendingPermission,
    terminalOutputs,
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
    error,
    // Loading states
    isSending,
    isCancelling,
    isResuming,
    hasMoreHistory,
    isLoadingOlderHistory,
    // Actions
    sendMessage,
    cancelPrompt,
    setMode,
    setModel,
    setConfigOption,
    respondToPermission,
    stopSession,
    resumeSession,
    refreshHistory,
    loadOlderHistory,
    // Message mutation
    upsertMessage,
    setMessages,
    // Internal state mutation
    restoreSessionState,
    setConnStatus,
    setStatus,
  };
}
