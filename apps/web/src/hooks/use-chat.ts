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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { UseChatOptions, UseChatResult } from "./use-chat.types";
import { useChatActions } from "./use-chat-actions";
import {
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  type StreamLifecycle,
} from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";
import { useChatHistory } from "./use-chat-history";
import {
  applyMessageDeltasIntoState,
  applyPartUpdate,
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
import { logChatStreamDebug } from "./use-chat-stream-debug";

const INVALID_EVENT_TOAST_COOLDOWN_MS = 5000;

function isChatNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    message?: unknown;
    data?: { code?: unknown } | null;
    shape?: {
      message?: unknown;
      data?: { code?: unknown } | null;
    } | null;
    cause?: unknown;
  };

  const messageValues = [candidate.message, candidate.shape?.message];
  for (const messageValue of messageValues) {
    if (
      typeof messageValue === "string" &&
      messageValue.toLowerCase().includes("chat not found")
    ) {
      return true;
    }
  }

  const codeValues = [candidate.data?.code, candidate.shape?.data?.code];
  for (const codeValue of codeValues) {
    if (
      typeof codeValue === "string" &&
      codeValue.toUpperCase() === "NOT_FOUND"
    ) {
      return true;
    }
  }

  if (candidate.cause && candidate.cause !== error) {
    return isChatNotFoundError(candidate.cause);
  }

  return false;
}

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
  const modelsRef = useRef<SessionModelState | null>(null);
  const commandsRef = useRef<AvailableCommand[]>(commands);
  const isResumingRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(chatId ?? null);
  const previousChatIdRef = useRef<string | null>(chatId ?? null);
  const previousStreamLifecycleRef = useRef<StreamLifecycle>(streamLifecycle);
  const statusRef = useRef<ChatStatus>(status);
  const reloadHistoryRef = useRef<(() => Promise<void>) | null>(null);
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
    modelsRef.current = models;
  }, [models]);
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
    const keys = pendingDeltaOrderRef.current;
    const deltaMap = pendingDeltaMapRef.current;
    const currentState = messageStateRef.current;
    const applyable: MessageDeltaChunk[] = [];
    const orphanKeys: string[] = [];

    for (const key of keys) {
      const chunk = deltaMap.get(key);
      if (!chunk) {
        continue;
      }
      const msg = currentState.byId.get(chunk.messageId);
      if (!msg) {
        // Message doesn't exist yet — keep for retry
        orphanKeys.push(key);
        continue;
      }
      const part = msg.parts[chunk.partIndex];
      if (!part) {
        // Part doesn't exist yet — keep for retry
        orphanKeys.push(key);
        continue;
      }
      if (part.type !== "text" && part.type !== "reasoning") {
        // Part exists but wrong type — discard
        deltaMap.delete(key);
        continue;
      }
      applyable.push(chunk);
      deltaMap.delete(key);
    }
    pendingDeltaOrderRef.current = orphanKeys;
    if (applyable.length > 0) {
      updateMessageState((prev) =>
        applyMessageDeltasIntoState(prev, applyable)
      );
    }
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
  const fetchHistoryPage = useCallback(
    (input: {
      chatId: string;
      cursor?: number;
      direction: "backward";
      limit: number;
      includeCompacted: true;
    }) => utils.getSessionMessagesPage.fetch(input),
    [utils]
  );
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
    fetchHistoryPage,
  });
  const loadHistoryRef = useRef(loadHistory);
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  }, [loadHistory]);
  reloadHistoryRef.current = async () => {
    await loadHistory(true);
  };
  // Apply session state helper
  const restoreSessionState = useCallback((data: SessionStateData) => {
    applySessionState(data, {
      onStatusChange: setStatus,
      onModesChange: (m) => {
        setModes(m);
        modesRef.current = m;
      },
      onModelsChange: (nextModels) => {
        setModels(nextModels);
        modelsRef.current = nextModels;
      },
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
  const normalizedSessionState = useMemo(() => {
    if (!sessionState) {
      return null;
    }
    return normalizeSessionStateData(sessionState);
  }, [sessionState]);
  const isStoppedSession = normalizedSessionState?.status === "stopped";
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
    resetHistoryState();
    setPendingPermission(null);
    setError(null);
    setModes(null);
    modesRef.current = null;
    setModels(null);
    modelsRef.current = null;
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
  }, [chatId, clearPendingDeltas, readOnly, resetHistoryState]);

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
    chatDebug("history", "loadHistory requested by effect", {
      chatId: chatId ?? null,
      connStatus,
      streamLifecycle,
    });
    void loadHistoryRef.current();
  }, [chatId, connStatus, streamLifecycle]);

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
    if (
      !(activeChatId && normalizedSessionState) ||
      connStatus !== "connecting"
    ) {
      return;
    }
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
      setStreamLifecycle("idle");
      setLoadSessionSupported(stateToRestore.loadSessionSupported ?? false);
      restoreSessionState(stateToRestore);
      isResumingRef.current = false;
      return;
    }
    restoreSessionState(stateToRestore);
    isResumingRef.current = false;
  }, [chatId, normalizedSessionState, connStatus, restoreSessionState]);
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
      if (
        event.type === "connected" ||
        event.type === "chat_status" ||
        event.type === "ui_message" ||
        event.type === "chat_finish" ||
        event.type === "error"
      ) {
        chatDebug("stream", "received session event", {
          chatId: activeChatIdRef.current,
          eventType: event.type,
          ...(event.type === "chat_status"
            ? {
                status: event.status,
                turnId: event.turnId ?? null,
              }
            : {}),
          ...(event.type === "ui_message"
            ? {
                messageId: event.message.id,
                messageRole: event.message.role,
                partsCount: event.message.parts.length,
                createdAt: event.message.createdAt ?? null,
              }
            : {}),
          ...(event.type === "chat_finish"
            ? {
                stopReason: event.stopReason,
                finishReason: event.finishReason,
                messageId: event.messageId ?? event.message?.id ?? null,
                turnId: event.turnId ?? null,
              }
            : {}),
          ...(event.type === "error"
            ? {
                error: event.error,
              }
            : {}),
        });
      }
      if (shouldLogChatStreamDebug()) {
        logChatStreamDebug({
          event,
          activeChatId: activeChatIdRef.current,
          state: messageStateRef.current,
        });
      }
      if (event.type === "chat_finish" && !isTurnMatched(event.turnId)) {
        return;
      }
      setStreamLifecycle((prev) =>
        nextLifecycleOnSubscriptionEvent({ current: prev, event })
      );
      if (event.type === "ui_message_delta") {
        enqueueDeltaChunk(event);
        return;
      }
      flushPendingDeltas();
      processSessionEvent(
        event,
        {
          currentModes: modesRef.current,
          currentModels: modelsRef.current,
        },
        {
          onStatusChange: setStatus,
          onConnStatusChange: setConnStatus,
          onMessageUpsert: (message) => {
            const normalizedMessage = normalizeMessage(message);
            updateMessageState((prev) =>
              upsertMessageIntoState(prev, normalizedMessage)
            );
          },
          onMessagePartUpdate: (partEvent) => {
            updateMessageState((prev) => applyPartUpdate(prev, partEvent));
          },
          getMessageById: (messageId) =>
            messageStateRef.current.byId.get(messageId),
          getMessagesForPermission: () => messageStateRef.current.byId.values(),
          onPendingPermissionChange: setPendingPermission,
          onModesChange: (m) => {
            setModes(m);
            modesRef.current = m;
          },
          onModelsChange: (nextModels) => {
            setModels(nextModels);
            modelsRef.current = nextModels;
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
      // After processing non-delta events (which may create messages/parts),
      // retry any orphan deltas that were waiting for their base.
      if (pendingDeltaOrderRef.current.length > 0) {
        flushPendingDeltas();
      }
      if (
        event.type === "chat_finish" &&
        messageStateRef.current.order.length === 0
      ) {
        loadHistory(true);
      }
      if (
        event.type === "chat_finish" &&
        event.turnId &&
        activeTurnIdRef.current &&
        activeTurnIdRef.current === event.turnId
      ) {
        activeTurnIdRef.current = null;
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
      enqueueDeltaChunk,
      flushPendingDeltas,
      isTurnMatched,
      loadHistory,
      onFinish,
      onError,
      updateMessageState,
    ]
  );
  // Subscription
  const subscriptionEnabled =
    !!chatId &&
    !readOnly &&
    streamLifecycle !== "idle" &&
    (!isStoppedSession || isResumingRef.current);
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
        const parsedEvent = parseBroadcastEvent(rawEvent);
        if (parsedEvent.status === "ignored_unknown_event") {
          return;
        }
        if (parsedEvent.status === "invalid_payload") {
          console.warn("[Client] Dropped invalid session event", {
            error: parsedEvent.error,
          });
          const now = Date.now();
          if (
            now - invalidEventToastAtRef.current >=
            INVALID_EVENT_TOAST_COOLDOWN_MS
          ) {
            invalidEventToastAtRef.current = now;
            toast.warning("Dropped malformed ACP event. Stream keeps running.");
          }
          return;
        }
        try {
          handleSessionEvent(parsedEvent.event);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to process chat session event";
          console.warn("[Client] Failed to process session event", {
            error: message,
          });
          setError(message);
        }
      },
      onError(err) {
        if (isChatNotFoundError(err)) {
          clearPendingDeltas();
          setStreamLifecycle("idle");
          setConnStatus("idle");
          setStatus("inactive");
          setError(null);
          return;
        }
        console.error("[Client] Subscription error:", err);
        clearPendingDeltas();
        setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
        setConnStatus("connecting");
        setError(err.message);
        setStatus("connecting");
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
    configOptions,
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
    onLocalConfigOptionMutated: () => {
      hasLocalConfigOverrideRef.current = true;
    },
    onLocalModeMutated: () => {
      hasLocalModeOverrideRef.current = true;
    },
    onLocalModelMutated: () => {
      hasLocalModelOverrideRef.current = true;
    },
    invalidateHistoryLoads,
    clearHistoryWindow,
    loadHistory,
    onResumeStateHydrated: () => {
      hasLocalModeOverrideRef.current = false;
      hasLocalModelOverrideRef.current = false;
      hasLocalConfigOverrideRef.current = false;
    },
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
