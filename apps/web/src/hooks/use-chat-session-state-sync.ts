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
  SupervisorSessionState,
} from "@repo/shared";
import { applySessionState, resolveSessionSelectionState } from "@repo/shared";
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
import { chatDebug } from "./use-chat-debug";
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
  configOptionsRef: MutableRefObject<SessionConfigOption[]>;
  commandsRef: MutableRefObject<AvailableCommand[]>;
  isResumingRef: MutableRefObject<boolean>;
  activeTurnIdRef: MutableRefObject<string | null>;
  blockedTurnIdsRef: MutableRefObject<Set<string>>;
  completedTurnIdsRef: MutableRefObject<Set<string>>;
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
  setSupervisor: Dispatch<SetStateAction<SupervisorSessionState | null>>;
  setSupervisorCapable: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
}

function logSessionStateDebug(
  message: string,
  meta?: Record<string, unknown>
): void {
  chatDebug("session-state", message, meta);
  if (!import.meta.env.DEV) {
    return;
  }
  if (meta) {
    console.debug(`[ACP Session State] ${message}`, meta);
    return;
  }
  console.debug(`[ACP Session State] ${message}`);
}

function shouldBackfillModeState(
  currentModes: SessionModeState | null,
  nextModes: SessionModeState | null
): boolean {
  if (!nextModes) {
    return false;
  }
  if (!currentModes) {
    return true;
  }
  if (currentModes.currentModeId !== nextModes.currentModeId) {
    return true;
  }
  return currentModes.availableModes.length < nextModes.availableModes.length;
}

function shouldBackfillModelState(
  currentModels: SessionModelState | null,
  nextModels: SessionModelState | null
): boolean {
  if (!nextModels) {
    return false;
  }
  if (!currentModels) {
    return true;
  }
  if (currentModels.currentModelId !== nextModels.currentModelId) {
    return true;
  }
  return (
    currentModels.availableModels.length < nextModels.availableModels.length
  );
}

export function shouldBackfillConnectedSessionState(params: {
  normalizedSessionState: SessionStateData;
  currentModes: SessionModeState | null;
  currentModels: SessionModelState | null;
}): boolean {
  const { normalizedSessionState, currentModes, currentModels } = params;
  const derivedSelection = resolveSessionSelectionState({
    configOptions: normalizedSessionState.configOptions,
    modes: normalizedSessionState.modes ?? null,
    models: normalizedSessionState.models ?? null,
  });
  const nextModes = derivedSelection.modes ?? normalizedSessionState.modes ?? null;
  const nextModels =
    derivedSelection.models ?? normalizedSessionState.models ?? null;
  return (
    shouldBackfillModeState(currentModes, nextModes) ||
    shouldBackfillModelState(currentModels, nextModels)
  );
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
    configOptionsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
    completedTurnIdsRef,
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
    setSupervisor,
    setSupervisorCapable,
    setStatus,
    setConnStatus,
    setStreamLifecycle,
  } = params;

  const restoreSessionState = useCallback(
    (data: SessionStateData) => {
      logSessionStateDebug("applySessionState start", {
        chatId: chatId ?? null,
        chatStatus: data.chatStatus ?? null,
        status: data.status ?? null,
        hasModes: data.modes !== undefined,
        hasModels: data.models !== undefined,
        hasConfigOptions: data.configOptions !== undefined,
      });
      applySessionState(data, {
        onStatusChange: setStatus,
        onModesChange: (nextModes) => {
          logSessionStateDebug("onModesChange from session state", {
            chatId: chatId ?? null,
            currentModeId: nextModes?.currentModeId ?? null,
            availableModesCount: nextModes?.availableModes?.length ?? 0,
          });
          setModes(nextModes);
          modesRef.current = nextModes;
        },
        onModelsChange: (nextModels) => {
          logSessionStateDebug("onModelsChange from session state", {
            chatId: chatId ?? null,
            currentModelId: nextModels?.currentModelId ?? null,
            availableModelsCount: nextModels?.availableModels?.length ?? 0,
          });
          setModels(nextModels);
          modelsRef.current = nextModels;
        },
        onSupportsModelSwitchingChange: setSupportsModelSwitching,
        getCommands: () => commandsRef.current,
        onCommandsChange: (nextCommands) => {
          commandsRef.current = nextCommands;
          setCommands(nextCommands);
        },
        onConfigOptionsChange: (nextConfigOptions) => {
          configOptionsRef.current = nextConfigOptions;
          setConfigOptions(nextConfigOptions);
        },
        onSessionInfoChange: setSessionInfo,
        onPromptCapabilitiesChange: setPromptCapabilities,
        onLoadSessionSupportedChange: setLoadSessionSupported,
        onAgentInfoChange: setAgentInfo,
        onConnStatusChange: setConnStatus,
        onSupervisorChange: (nextSupervisor) => {
          logSessionStateDebug("onSupervisorChange from session state", {
            chatId: chatId ?? null,
            supervisor: nextSupervisor,
          });
          setSupervisor(nextSupervisor);
        },
        onSupervisorCapableChange: (capable) => {
          logSessionStateDebug("onSupervisorCapableChange from session state", {
            chatId: chatId ?? null,
            capable,
            isResuming: isResumingRef.current,
          });
          setSupervisorCapable(capable);
        },
      });
    },
    [
      chatId,
      configOptionsRef,
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
      setSupervisor,
      setSupervisorCapable,
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
    configOptionsRef.current = [];
    setSessionInfo(null);
    setPromptCapabilities(null);
    setAgentInfo(null);
    setLoadSessionSupported(undefined);
    setSupervisor(null);
    setSupervisorCapable(false);
    isResumingRef.current = false;
    activeTurnIdRef.current = null;
    blockedTurnIdsRef.current.clear();
    completedTurnIdsRef.current.clear();
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
    completedTurnIdsRef,
    chatId,
    configOptionsRef,
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
    setSupervisor,
    setSupervisorCapable,
    setSupportsModelSwitching,
  ]);

  useEffect(() => {
    if (connStatus === "connecting") {
      markHistoryNotApplied();
    }
  }, [connStatus, markHistoryNotApplied]);

  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!(activeChatId && normalizedSessionState)) {
      return;
    }
    const shouldRestoreWhileConnecting = connStatus === "connecting";
    const shouldBackfillWhileConnected =
      connStatus === "connected" &&
      shouldBackfillConnectedSessionState({
        normalizedSessionState,
        currentModes: modesRef.current,
        currentModels: modelsRef.current,
      });
    if (!(shouldRestoreWhileConnecting || shouldBackfillWhileConnected)) {
      logSessionStateDebug("skip session-state hydrate", {
        chatId: activeChatId,
        connStatus,
        hasModesInState: normalizedSessionState.modes !== undefined,
        hasModelsInState: normalizedSessionState.models !== undefined,
        currentModesPresent: Boolean(modesRef.current),
        currentModelsPresent: Boolean(modelsRef.current),
      });
      return;
    }
    logSessionStateDebug("hydrate session-state snapshot", {
      chatId: activeChatId,
      connStatus,
      shouldRestoreWhileConnecting,
      shouldBackfillWhileConnected,
      hasModesInState: normalizedSessionState.modes !== undefined,
      hasModelsInState: normalizedSessionState.models !== undefined,
      hasConfigOptionsInState: normalizedSessionState.configOptions !== undefined,
      currentModesPresent: Boolean(modesRef.current),
      currentModelsPresent: Boolean(modelsRef.current),
    });
    const stateToRestore: SessionStateData = {
      ...normalizedSessionState,
      ...(hasLocalModeOverrideRef.current ? { modes: undefined } : {}),
      ...(hasLocalModelOverrideRef.current ? { models: undefined } : {}),
      ...(hasLocalConfigOverrideRef.current ? { configOptions: undefined } : {}),
    };
    if (isResumingRef.current && normalizedSessionState.status === "stopped") {
      logSessionStateDebug("skip stopped-state hydrate while resuming", {
        chatId: activeChatId,
      });
      // Apply supervisorCapable even when skipping other stopped-session hydration
      // so the UI gate (connStatus === "connected" && supervisorCapable) can be
      // satisfied after server env is enabled and session resumes.
      if (normalizedSessionState.supervisorCapable !== undefined) {
        console.debug("[SupervisorDebug] resume-guard applying supervisorCapable from stopped state", {
          chatId: activeChatId,
          supervisorCapable: normalizedSessionState.supervisorCapable,
        });
        setSupervisorCapable(normalizedSessionState.supervisorCapable);
      }
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
    modesRef,
    modelsRef,
    normalizedSessionState,
    restoreSessionState,
    setLoadSessionSupported,
    setStreamLifecycle,
  ]);

  return {
    restoreSessionState,
  };
}
