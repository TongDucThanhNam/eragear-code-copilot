/**
 * useChat Hook (Web)
 *
 * Web-specific adapter for the shared chat core.
 * Wraps tRPC mutations + subscription with React state management.
 */
import type {
  AgentInfo,
  AvailableCommand,
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  PromptCapabilities,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
  UIMessage,
} from "@repo/shared";
import {
  findPendingPermission,
  isChatBusyStatus,
} from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  getChatMessageStateSnapshot,
  getChatTerminalOutputsSnapshot,
  useChatMessages,
  useChatStreamStore,
  useChatTerminalOutputs,
} from "@/store/chat-stream-store";
import type { UseChatOptions, UseChatResult } from "./use-chat.types";
import { useChatActions } from "./use-chat-actions";
import {
  nextLifecycleOnChatIdChange,
  type StreamLifecycle,
} from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";
import { useChatHistory } from "./use-chat-history";
import { useLiveSubscriptionGate } from "./use-chat-live-subscription";
import {
  type MessageState,
  replaceMessagesState,
  upsertMessageIntoState,
} from "./use-chat-message-state";
import { normalizeMessages } from "./use-chat-normalize";
import { useChatSessionEventHandler } from "./use-chat-session-event-handler";
import { useChatSessionStateSync } from "./use-chat-session-state-sync";
import { useChatSubscription } from "./use-chat-subscription";

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
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
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
  const connectedChatIdRef = useRef<string | null>(null);
  const connStatusRef = useRef<ConnectionStatus>(connStatus);
  const statusRef = useRef<ChatStatus>(status);
  const reloadHistoryRef = useRef<(() => Promise<void>) | null>(null);
  const hasLocalModeOverrideRef = useRef(false);
  const hasLocalModelOverrideRef = useRef(false);
  const hasLocalConfigOverrideRef = useRef(false);
  const messages = useChatMessages(chatId);
  const terminalOutputs = useChatTerminalOutputs(chatId);
  // Keep refs in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    connStatusRef.current = connStatus;
  }, [connStatus]);
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
    markHistoryAppliedFromRuntime,
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
  const { restoreSessionState } = useChatSessionStateSync({
    chatId,
    readOnly,
    streamLifecycle,
    connStatus,
    previousChatIdRef,
    connectedChatIdRef,
    messageStateRef,
    terminalOutputsRef,
    modesRef,
    modelsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
    hasLocalModeOverrideRef,
    hasLocalModelOverrideRef,
    hasLocalConfigOverrideRef,
    resetHistoryState,
    markHistoryNotApplied,
    setPendingPermission,
    setError,
    setModes,
    setModels,
    setSupportsModelSwitching,
    setCommands,
    setConfigOptions,
    setSessionInfo,
    setPromptCapabilities,
    setAgentInfo,
    setLoadSessionSupported,
    setStatus,
    setConnStatus,
    setStreamLifecycle,
  });
  const loadHistoryRef = useRef(loadHistory);
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  }, [loadHistory]);
  reloadHistoryRef.current = async () => {
    await loadHistory(true);
  };

  // Load stored history once, merging pages by message.id
  useEffect(() => {
    chatDebug("history", "loadHistory requested by effect", {
      chatId: chatId ?? null,
      connStatus,
      streamLifecycle,
    });
    void loadHistoryRef.current();
  }, [chatId, connStatus, streamLifecycle]);

  const { ensureLiveSubscription } = useLiveSubscriptionGate({
    readOnly,
    connStatus,
    streamLifecycle,
    activeChatIdRef,
    connectedChatIdRef,
    statusRef,
    connStatusRef,
    loadHistory,
    setStreamLifecycle,
    setConnStatus,
  });
  const handleSessionEvent = useChatSessionEventHandler({
    loadHistory,
    onFinish,
    onError,
    updateMessageState,
    activeChatIdRef,
    connectedChatIdRef,
    messageStateRef,
    terminalOutputsRef,
    modesRef,
    modelsRef,
    commandsRef,
    activeTurnIdRef,
    isResumingRef,
    setStreamLifecycle,
    setStatus,
    setConnStatus,
    setPendingPermission,
    setModes,
    setModels,
    setCommands,
    setConfigOptions,
    setSessionInfo,
    setError,
  });

  useChatSubscription({
    chatId,
    readOnly,
    subscriptionEpoch,
    activeChatIdRef,
    handleSessionEvent,
    setStreamLifecycle,
    setConnStatus,
    setStatus,
    setError,
  });
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
    markHistoryAppliedFromRuntime,
    loadHistory,
    onResumeStateHydrated: () => {
      hasLocalModeOverrideRef.current = false;
      hasLocalModelOverrideRef.current = false;
      hasLocalConfigOverrideRef.current = false;
    },
    ensureLiveSubscription,
    bumpSessionEventsEpoch: useCallback(() => {
      chatDebug(
        "stream",
        "bumpSessionEventsEpoch: forcing tRPC subscription remount",
        { chatId: activeChatIdRef.current }
      );
      connectedChatIdRef.current = null;
      setStreamLifecycle("bootstrapping");
      setSubscriptionEpoch((prev) => prev + 1);
    }, []),
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
