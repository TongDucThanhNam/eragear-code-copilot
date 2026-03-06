/**
 * useChat Hook (Web)
 *
 * Web-specific adapter for the shared chat core.
 * Wraps tRPC mutations + subscription with React state management.
 */
import { isChatBusyStatus } from "@repo/shared";
import { useCallback, useEffect, useRef } from "react";
import { useChatPendingPermission } from "@/store/chat-stream-store";
import { trpc } from "@/lib/trpc";
import type { UseChatOptions, UseChatResult } from "./use-chat.types";
import { useChatActions } from "./use-chat-actions";
import { useChatCoreState } from "./use-chat-core-state";
import { chatDebug } from "./use-chat-debug";
import { useChatHistory } from "./use-chat-history";
import { useLiveSubscriptionGate } from "./use-chat-live-subscription";
import { normalizeMessages } from "./use-chat-normalize";
import { useChatSessionEventHandler } from "./use-chat-session-event-handler";
import { useChatSessionStateSync } from "./use-chat-session-state-sync";
import { useChatSubscription } from "./use-chat-subscription";

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { chatId, readOnly = false, onFinish, onError } = options;
  const utils = trpc.useUtils();
  const {
    messages,
    status,
    setStatus,
    connStatus,
    setConnStatus,
    streamLifecycle,
    setStreamLifecycle,
    subscriptionEpoch,
    setSubscriptionEpoch,
    pendingPermission: transientPendingPermission,
    setPendingPermission,
    error,
    setError,
    modes,
    setModes,
    models,
    setModels,
    supportsModelSwitching,
    setSupportsModelSwitching,
    commands,
    setCommands,
    configOptions,
    setConfigOptions,
    sessionInfo,
    setSessionInfo,
    promptCapabilities,
    setPromptCapabilities,
    agentInfo,
    setAgentInfo,
    loadSessionSupported,
    setLoadSessionSupported,
    messageStateRef,
    modesRef,
    modelsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
    activeChatIdRef,
    previousChatIdRef,
    connectedChatIdRef,
    connStatusRef,
    statusRef,
    hasLocalModeOverrideRef,
    hasLocalModelOverrideRef,
    hasLocalConfigOverrideRef,
    updateMessageState,
    upsertMessage,
    setMessages,
    isActiveChat,
  } = useChatCoreState({
    chatId,
    readOnly,
  });
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
    modesRef,
    modelsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
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

  // Load stored history once, merging pages by message.id
  useEffect(() => {
    chatDebug("history", "loadHistory requested by effect", {
      chatId: chatId ?? null,
      connStatus,
      streamLifecycle,
    });
    loadHistoryRef.current();
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
    modesRef,
    modelsRef,
    commandsRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
    isResumingRef,
    statusRef,
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
    blockedTurnIdsRef,
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
  const pendingPermissionFromMessages = useChatPendingPermission(chatId);
  const pendingPermission =
    pendingPermissionFromMessages ?? transientPendingPermission;
  // Derived state
  const isStreaming = isChatBusyStatus(status);
  return {
    // State
    messages,
    status,
    connStatus,
    isStreaming,
    pendingPermission,
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
