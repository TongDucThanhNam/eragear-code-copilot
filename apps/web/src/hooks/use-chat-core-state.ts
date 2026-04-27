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
  SupervisorDecisionSummary,
  SupervisorSessionState,
  UIMessage,
} from "@repo/shared";
import { findPendingPermission } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatMessageStateSnapshot,
  useChatStreamStore,
} from "@/store/chat-stream-store";
import {
  nextLifecycleOnChatIdChange,
  type StreamLifecycle,
} from "./use-chat-connection.machine";
import {
  type MessageState,
  replaceMessagesState,
  upsertMessageIntoState,
} from "./use-chat-message-state";

interface UseChatCoreStateParams {
  chatId: string | null | undefined;
  readOnly: boolean;
}

// Keep use-chat.ts focused on workflow wiring by extracting local state+refs.
export function useChatCoreState({ chatId, readOnly }: UseChatCoreStateParams) {
  const [status, setStatusState] = useState<ChatStatus>(
    chatId && !readOnly ? "connecting" : "inactive"
  );

  const setStatus = useCallback((next: React.SetStateAction<ChatStatus>) => {
    const nextStatus =
      typeof next === "function"
        ? (next as (prev: ChatStatus) => ChatStatus)(statusRef.current)
        : next;
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
  }, []);
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
  const [supervisor, setSupervisor] =
    useState<SupervisorSessionState | null>(null);
  const [supervisorCapable, setSupervisorCapable] = useState(false);

  const messageStateRef = useRef<MessageState>(
    getChatMessageStateSnapshot(chatId ?? null)
  );
  const modesRef = useRef<SessionModeState | null>(null);
  const modelsRef = useRef<SessionModelState | null>(null);
  const configOptionsRef = useRef<SessionConfigOption[]>([]);
  const commandsRef = useRef<AvailableCommand[]>(commands);
  const isResumingRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const blockedTurnIdsRef = useRef<Set<string>>(new Set());
  const completedTurnIdsRef = useRef<Set<string>>(new Set());
  const activeChatIdRef = useRef<string | null>(chatId ?? null);
  const previousChatIdRef = useRef<string | null>(chatId ?? null);
  const connectedChatIdRef = useRef<string | null>(null);
  const connStatusRef = useRef<ConnectionStatus>(connStatus);
  const statusRef = useRef<ChatStatus>(status);
  const hasLocalModeOverrideRef = useRef(false);
  const hasLocalModelOverrideRef = useRef(false);
  const hasLocalConfigOverrideRef = useRef(false);
  const supervisorRef = useRef<SupervisorSessionState | null>(null);
  const lastSupervisorDecisionRef = useRef<SupervisorDecisionSummary | null>(
    null
  );

  statusRef.current = status;
  connStatusRef.current = connStatus;
  activeChatIdRef.current = chatId ?? null;
  modesRef.current = modes;
  modelsRef.current = models;
  configOptionsRef.current = configOptions;
  commandsRef.current = commands;
  supervisorRef.current = supervisor;

  const messages = getChatMessageStateSnapshot(chatId ?? null).orderedMessages;

  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!activeChatId) {
      messageStateRef.current = getChatMessageStateSnapshot(null);
      return;
    }
    messageStateRef.current = useChatStreamStore
      .getState()
      .getMessageState(activeChatId);
    return useChatStreamStore.subscribe((nextState, prevState) => {
      const nextMessageState =
        nextState.byChatId[activeChatId]?.messageState ??
        getChatMessageStateSnapshot(null);
      const prevMessageState =
        prevState.byChatId[activeChatId]?.messageState ??
        getChatMessageStateSnapshot(null);
      if (nextMessageState !== prevMessageState) {
        messageStateRef.current = nextMessageState;
      }
    });
  }, [chatId]);

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

  return {
    messages,
    status,
    setStatus,
    connStatus,
    setConnStatus,
    streamLifecycle,
    setStreamLifecycle,
    subscriptionEpoch,
    setSubscriptionEpoch,
    pendingPermission,
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
    supervisor,
    setSupervisor,
    supervisorCapable,
    setSupervisorCapable,
    messageStateRef,
    modesRef,
    modelsRef,
    configOptionsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
    completedTurnIdsRef,
    activeChatIdRef,
    previousChatIdRef,
    connectedChatIdRef,
    connStatusRef,
    statusRef,
    hasLocalModeOverrideRef,
    hasLocalModelOverrideRef,
    hasLocalConfigOverrideRef,
    supervisorRef,
    lastSupervisorDecisionRef,
    updateMessageState,
    upsertMessage,
    setMessages,
    isActiveChat,
  };
}

export type UseChatCoreStateResult = ReturnType<typeof useChatCoreState>;
