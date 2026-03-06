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
  SessionStateData,
} from "@repo/shared";
import { applySessionState } from "@repo/shared";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  getChatMessageStateSnapshot,
  useChatStreamStore,
} from "@/store/chat-stream-store";
import { nextLifecycleOnChatIdChange } from "./use-chat-connection.machine";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import type { MessageState } from "./use-chat-message-state";
import { normalizeSessionStateData } from "./use-chat-normalize";

interface UseChatSessionStateSyncParams {
  chatId?: string | null;
  readOnly: boolean;
  streamLifecycle: StreamLifecycle;
  connStatus: ConnectionStatus;
  previousChatIdRef: MutableRefObject<string | null>;
  connectedChatIdRef: MutableRefObject<string | null>;
  messageStateRef: MutableRefObject<MessageState>;
  modesRef: MutableRefObject<SessionModeState | null>;
  modelsRef: MutableRefObject<SessionModelState | null>;
  commandsRef: MutableRefObject<AvailableCommand[]>;
  isResumingRef: MutableRefObject<boolean>;
  activeTurnIdRef: MutableRefObject<string | null>;
  blockedTurnIdsRef: MutableRefObject<Set<string>>;
  hasLocalModeOverrideRef: MutableRefObject<boolean>;
  hasLocalModelOverrideRef: MutableRefObject<boolean>;
  hasLocalConfigOverrideRef: MutableRefObject<boolean>;
  resetHistoryState: () => void;
  markHistoryNotApplied: () => void;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setModes: Dispatch<SetStateAction<SessionModeState | null>>;
  setModels: Dispatch<SetStateAction<SessionModelState | null>>;
  setSupportsModelSwitching: Dispatch<SetStateAction<boolean>>;
  setCommands: Dispatch<SetStateAction<AvailableCommand[]>>;
  setConfigOptions: Dispatch<SetStateAction<SessionConfigOption[]>>;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  setPromptCapabilities: Dispatch<SetStateAction<PromptCapabilities | null>>;
  setAgentInfo: Dispatch<SetStateAction<AgentInfo | null>>;
  setLoadSessionSupported: Dispatch<SetStateAction<boolean | undefined>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
}

export function useChatSessionStateSync(params: UseChatSessionStateSyncParams) {
  const {
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
  } = params;

  const restoreSessionState = useCallback(
    (data: SessionStateData) => {
      applySessionState(data, {
        onStatusChange: setStatus,
        onModesChange: (nextModes) => {
          setModes(nextModes);
          modesRef.current = nextModes;
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
    },
    [
      commandsRef,
      modesRef,
      modelsRef,
      setAgentInfo,
      setCommands,
      setConfigOptions,
      setConnStatus,
      setLoadSessionSupported,
      setModes,
      setModels,
      setPromptCapabilities,
      setSessionInfo,
      setStatus,
      setSupportsModelSwitching,
    ]
  );

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
    connectedChatIdRef.current = null;
    hasLocalModeOverrideRef.current = false;
    hasLocalModelOverrideRef.current = false;
    hasLocalConfigOverrideRef.current = false;
    if (chatId) {
      messageStateRef.current = streamStore.getMessageState(chatId);
    } else {
      messageStateRef.current = getChatMessageStateSnapshot(null);
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
    blockedTurnIdsRef.current.clear();
    setStreamLifecycle(nextLifecycle);
    if (nextLifecycle === "idle") {
      setConnStatus("idle");
      setStatus("inactive");
    } else {
      setConnStatus("connecting");
      setStatus("connecting");
    }
  }, [
    activeTurnIdRef,
    blockedTurnIdsRef,
    chatId,
    commandsRef,
    connectedChatIdRef,
    hasLocalConfigOverrideRef,
    hasLocalModeOverrideRef,
    hasLocalModelOverrideRef,
    isResumingRef,
    messageStateRef,
    modesRef,
    modelsRef,
    previousChatIdRef,
    readOnly,
    resetHistoryState,
    setAgentInfo,
    setCommands,
    setConfigOptions,
    setConnStatus,
    setError,
    setLoadSessionSupported,
    setModes,
    setModels,
    setPendingPermission,
    setPromptCapabilities,
    setSessionInfo,
    setStatus,
    setStreamLifecycle,
    setSupportsModelSwitching,
  ]);

  useEffect(() => {
    if (connStatus === "connecting") {
      markHistoryNotApplied();
    }
  }, [connStatus, markHistoryNotApplied]);

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
      ...(hasLocalConfigOverrideRef.current ? { configOptions: undefined } : {}),
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
  }, [
    chatId,
    connStatus,
    hasLocalConfigOverrideRef,
    hasLocalModeOverrideRef,
    hasLocalModelOverrideRef,
    isResumingRef,
    normalizedSessionState,
    restoreSessionState,
    setLoadSessionSupported,
    setStreamLifecycle,
  ]);

  return {
    restoreSessionState,
  };
}
