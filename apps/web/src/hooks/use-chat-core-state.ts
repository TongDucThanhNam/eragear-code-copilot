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
import { findPendingPermission } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatMessageStateSnapshot,
  getChatTerminalOutputsSnapshot,
  useChatMessages,
  useChatStreamStore,
  useChatTerminalOutputs,
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
  const hasLocalModeOverrideRef = useRef(false);
  const hasLocalModelOverrideRef = useRef(false);
  const hasLocalConfigOverrideRef = useRef(false);

  const messages = useChatMessages(chatId);
  const terminalOutputs = useChatTerminalOutputs(chatId);

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
    terminalOutputs,
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
    messageStateRef,
    terminalOutputsRef,
    modesRef,
    modelsRef,
    commandsRef,
    isResumingRef,
    activeTurnIdRef,
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
  };
}

export type UseChatCoreStateResult = ReturnType<typeof useChatCoreState>;
