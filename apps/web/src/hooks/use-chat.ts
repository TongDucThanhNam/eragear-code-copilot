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
  SessionStateData,
  SessionModelState,
  SessionModeState,
  UIMessage,
  UseChatOptions as SharedUseChatOptions,
} from "@repo/shared";
import {
  applySessionState,
  findPendingPermission,
  isChatBusyStatus,
  parseBroadcastEventStrict,
  parseUiMessageArrayStrict,
  parseUiMessageStrict,
  processSessionEvent,
} from "@repo/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  nextLifecycleOnChatIdChange,
  nextLifecycleOnSubscriptionError,
  nextLifecycleOnSubscriptionEvent,
  nextLifecycleOnSubscriptionStart,
  type StreamLifecycle,
} from "./use-chat-connection.machine";
import {
  createEmptyMessageState,
  getOrderedMessages,
  mergeMessagesIntoState,
  replaceMessagesState,
  type MessageState,
  type MessageStateUpdater,
  upsertMessageIntoState,
} from "./use-chat-message-state";
// ============================================================================
// Types
// ============================================================================
export type UseChatOptions = SharedUseChatOptions;
export interface UseChatResult {
  // State
  messages: UIMessage[];
  status: ChatStatus;
  connStatus: ConnectionStatus;
  isStreaming: boolean;
  pendingPermission: PermissionRequest | null;
  terminalOutputs: Record<string, string>;
  // Session state
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  configOptions: SessionConfigOption[];
  sessionInfo: SessionInfo | null;
  promptCapabilities: PromptCapabilities | null;
  agentInfo: AgentInfo | null;
  loadSessionSupported: boolean | undefined;
  error: string | null;
  // Loading states
  isSending: boolean;
  isCancelling: boolean;
  isResuming: boolean;
  // Actions
  sendMessage: (
    text: string,
    options?: {
      images?: { base64: string; mimeType: string }[];
      resources?: { uri: string; text: string; mimeType?: string }[];
      resourceLinks?: { uri: string; name: string; mimeType?: string }[];
    }
  ) => Promise<boolean>;
  cancelPrompt: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  // Message mutation
  upsertMessage: (message: UIMessage) => void;
  setMessages: (messages: UIMessage[]) => void;
  // Internal state mutation (for integration with existing code)
  restoreSessionState: (state: SessionStateData) => void;
  setConnStatus: (status: ConnectionStatus) => void;
  setStatus: (status: ChatStatus) => void;
}

const USER_MESSAGE_FALLBACK_TIMEOUT_MS = 1500;
const USER_MESSAGE_FALLBACK_RETRY_DELAY_MS = 300;
const USER_MESSAGE_FALLBACK_MAX_ATTEMPTS = 2;

function shouldLogChatStreamDebug(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const debugFlag = (
    window as typeof window & {
      __ERAGEAR_CHAT_DEBUG__?: boolean;
    }
  ).__ERAGEAR_CHAT_DEBUG__;
  if (typeof debugFlag === "boolean") {
    return debugFlag;
  }
  return import.meta.env.DEV;
}

type RawAgentInfo = {
  name?: string;
  title?: string;
  version?: string;
} | null;

type RawSessionStateData = Omit<
  SessionStateData,
  "modes" | "models" | "commands" | "configOptions" | "sessionInfo" | "agentInfo"
> & {
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  commands?: SessionStateData["commands"] | null;
  configOptions?: SessionStateData["configOptions"] | null;
  sessionInfo?: SessionStateData["sessionInfo"] | null;
  agentInfo?: RawAgentInfo;
};

const normalizeMessage = (message: unknown): UIMessage => {
  const parsed = parseUiMessageStrict(message);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

const normalizeMessages = (messages: unknown): UIMessage[] => {
  const parsed = parseUiMessageArrayStrict(messages);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

const normalizeAgentInfo = (
  agentInfo: RawAgentInfo | undefined
): AgentInfo | null | undefined => {
  if (agentInfo === undefined) {
    return undefined;
  }
  if (agentInfo === null) {
    return null;
  }
  if (typeof agentInfo.name !== "string" || typeof agentInfo.version !== "string") {
    return null;
  }
  return {
    name: agentInfo.name,
    version: agentInfo.version,
    ...(typeof agentInfo.title === "string" ? { title: agentInfo.title } : {}),
  };
};

const normalizeSessionStateData = (
  data: RawSessionStateData
): SessionStateData => {
  const { agentInfo: rawAgentInfo, ...rest } = data;
  const normalized: SessionStateData = {
    ...rest,
    modes: data.modes ?? undefined,
    models: data.models ?? undefined,
    commands: data.commands ?? undefined,
    configOptions: data.configOptions ?? undefined,
    sessionInfo: data.sessionInfo ?? null,
  };

  const agentInfo = normalizeAgentInfo(rawAgentInfo);
  if (agentInfo !== undefined) {
    normalized.agentInfo = agentInfo;
  }

  return normalized;
};

const parseBroadcastEvent = (event: unknown): BroadcastEvent => {
  const parsed = parseBroadcastEventStrict(event);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

// ============================================================================
// Hook Implementation
// ============================================================================
export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { chatId, readOnly = false, onFinish, onError } = options;
  const utils = trpc.useUtils();
  // Core state
  const [messageState, setMessageState] = useState<MessageState>(
    createEmptyMessageState
  );
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
  const [terminalOutputs, setTerminalOutputs] = useState<
    Record<string, string>
  >({});
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
  const messageStateRef = useRef<MessageState>(createEmptyMessageState());
  const modesRef = useRef<SessionModeState | null>(null);
  const isResumingRef = useRef(false);
  const historyAppliedRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const historyLoadVersionRef = useRef(0);
  const activeTurnIdRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(chatId ?? null);
  const pendingUserMessageFallbackTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const pendingUserMessageFallbackAbortRef = useRef(new AbortController());
  const pendingUserMessageFallbackGenerationRef = useRef(0);
  const previousStreamLifecycleRef = useRef<StreamLifecycle>(streamLifecycle);
  const statusRef = useRef<ChatStatus>(status);
  // Batched updates for performance
  const batchUpdateQueueRef = useRef<MessageStateUpdater[]>([]);
  const batchUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const resetPendingUserMessageFallbackController = useCallback(() => {
    pendingUserMessageFallbackAbortRef.current.abort();
    pendingUserMessageFallbackAbortRef.current = new AbortController();
    pendingUserMessageFallbackGenerationRef.current += 1;
  }, []);
  const messages = useMemo(() => getOrderedMessages(messageState), [messageState]);
  // Keep refs in sync
  useEffect(() => {
    messageStateRef.current = messageState;
  }, [messageState]);
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
    const nextLifecycle = nextLifecycleOnChatIdChange({
      hasChatId: Boolean(chatId),
      readOnly,
    });
    for (const [, timer] of pendingUserMessageFallbackTimersRef.current) {
      clearTimeout(timer);
    }
    pendingUserMessageFallbackTimersRef.current.clear();
    resetPendingUserMessageFallbackController();
    if (batchUpdateTimerRef.current) {
      clearTimeout(batchUpdateTimerRef.current);
      batchUpdateTimerRef.current = null;
    }
    batchUpdateQueueRef.current = [];
    const emptyState = createEmptyMessageState();
    setMessageState(emptyState);
    messageStateRef.current = emptyState;
    setPendingPermission(null);
    setTerminalOutputs({});
    setError(null);
    setModes(null);
    modesRef.current = null;
    setModels(null);
    setSupportsModelSwitching(false);
    setCommands([]);
    setConfigOptions([]);
    setSessionInfo(null);
    setPromptCapabilities(null);
    setAgentInfo(null);
    setLoadSessionSupported(undefined);
    isResumingRef.current = false;
    historyAppliedRef.current = false;
    historyLoadingRef.current = false;
    historyLoadVersionRef.current += 1;
    activeTurnIdRef.current = null;
    setStreamLifecycle(nextLifecycle);
    if (nextLifecycle === "idle") {
      setConnStatus("idle");
      setStatus("inactive");
    } else {
      setConnStatus("connecting");
      setStatus("connecting");
    }
  }, [chatId, readOnly, resetPendingUserMessageFallbackController]);
  useEffect(() => {
    if (connStatus === "connecting") {
      historyAppliedRef.current = false;
    }
  }, [connStatus]);
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, timer] of pendingUserMessageFallbackTimersRef.current) {
        clearTimeout(timer);
      }
      pendingUserMessageFallbackTimersRef.current.clear();
      resetPendingUserMessageFallbackController();
      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }
      historyLoadVersionRef.current += 1;
    };
  }, [resetPendingUserMessageFallbackController]);
  useEffect(() => {
    setPendingPermission(findPendingPermission(messages));
  }, [messages]);
  // Batch flush
  const flushBatchQueue = useCallback(() => {
    if (batchUpdateQueueRef.current.length === 0) {
      return;
    }
    const updates = batchUpdateQueueRef.current;
    batchUpdateQueueRef.current = [];
    setMessageState((prev) => {
      let result = prev;
      for (const updater of updates) {
        result = updater(result);
      }
      messageStateRef.current = result;
      return result;
    });
  }, []);
  const updateMessagesState = useCallback(
    (updater: MessageStateUpdater) => {
      batchUpdateQueueRef.current.push(updater);
      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }
      batchUpdateTimerRef.current = setTimeout(() => {
        batchUpdateTimerRef.current = null;
        flushBatchQueue();
      }, 16);
    },
    [flushBatchQueue]
  );
  // Upsert single message
  const upsertMessage = useCallback(
    (next: UIMessage) => {
      updateMessagesState((prev) => upsertMessageIntoState(prev, next));
    },
    [updateMessagesState]
  );
  const setMessages = useCallback((nextMessages: UIMessage[]) => {
    if (batchUpdateTimerRef.current) {
      clearTimeout(batchUpdateTimerRef.current);
      batchUpdateTimerRef.current = null;
    }
    batchUpdateQueueRef.current = [];
    const nextState = replaceMessagesState(nextMessages);
    setMessageState(nextState);
    messageStateRef.current = nextState;
  }, []);
  const clearPendingUserMessageFallback = useCallback((messageId: string) => {
    const timer = pendingUserMessageFallbackTimersRef.current.get(messageId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    pendingUserMessageFallbackTimersRef.current.delete(messageId);
  }, []);
  const clearAllPendingUserMessageFallbacks = useCallback(() => {
    for (const [, timer] of pendingUserMessageFallbackTimersRef.current) {
      clearTimeout(timer);
    }
    pendingUserMessageFallbackTimersRef.current.clear();
    resetPendingUserMessageFallbackController();
  }, [resetPendingUserMessageFallbackController]);
  const recoverMissingSentMessage = useCallback(
    function recoverMissingSentMessageInternal(
      activeChatId: string,
      messageId: string,
      attempt = 1,
      trigger: "initial" | "retry" | "chat_finish" = "initial"
    ) {
      const generation = pendingUserMessageFallbackGenerationRef.current;
      const abortSignal = pendingUserMessageFallbackAbortRef.current.signal;
      if (activeChatIdRef.current !== activeChatId || readOnly) {
        return;
      }
      if (messageStateRef.current.byId.has(messageId)) {
        return;
      }
      void utils.getSessionMessageById
        .fetch({
          chatId: activeChatId,
          messageId,
        })
        .then((result) => {
          if (
            abortSignal.aborted ||
            generation !== pendingUserMessageFallbackGenerationRef.current ||
            activeChatIdRef.current !== activeChatId ||
            readOnly
          ) {
            return;
          }
          const message = result.message;
          if (!message) {
            if (attempt < USER_MESSAGE_FALLBACK_MAX_ATTEMPTS) {
              console.warn("[Chat] Missing sent message, retrying fallback", {
                chatId: activeChatId,
                messageId,
                attempt,
                trigger,
              });
              clearPendingUserMessageFallback(messageId);
              const retryTimer = setTimeout(() => {
                if (
                  abortSignal.aborted ||
                  generation !== pendingUserMessageFallbackGenerationRef.current
                ) {
                  return;
                }
                pendingUserMessageFallbackTimersRef.current.delete(messageId);
                recoverMissingSentMessageInternal(
                  activeChatId,
                  messageId,
                  attempt + 1,
                  "retry"
                );
              }, USER_MESSAGE_FALLBACK_RETRY_DELAY_MS);
              pendingUserMessageFallbackTimersRef.current.set(
                messageId,
                retryTimer
              );
            }
            return;
          }
          if (messageStateRef.current.byId.has(message.id)) {
            return;
          }
          let normalizedMessage: UIMessage;
          try {
            normalizedMessage = normalizeMessage(message);
          } catch (parseError) {
            const parseErrorMessage =
              parseError instanceof Error
                ? parseError.message
                : "Invalid fallback session message payload";
            console.warn("[Chat] Dropping invalid recovered message", {
              chatId: activeChatId,
              messageId,
              error: parseErrorMessage,
            });
            setError(parseErrorMessage);
            onError?.(parseErrorMessage);
            return;
          }
          updateMessagesState((prev) =>
            upsertMessageIntoState(prev, normalizedMessage)
          );
        })
        .catch((fallbackError) => {
          const errorMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
          if (attempt < USER_MESSAGE_FALLBACK_MAX_ATTEMPTS) {
            console.warn("[Chat] Fallback fetch failed, retrying", {
              chatId: activeChatId,
              messageId,
              attempt,
              trigger,
              error: errorMessage,
            });
            clearPendingUserMessageFallback(messageId);
            const retryTimer = setTimeout(() => {
              if (
                abortSignal.aborted ||
                generation !== pendingUserMessageFallbackGenerationRef.current
              ) {
                return;
              }
              pendingUserMessageFallbackTimersRef.current.delete(messageId);
              recoverMissingSentMessageInternal(
                activeChatId,
                messageId,
                attempt + 1,
                "retry"
              );
            }, USER_MESSAGE_FALLBACK_RETRY_DELAY_MS);
            pendingUserMessageFallbackTimersRef.current.set(
              messageId,
              retryTimer
            );
            return;
          }
          console.warn("[Chat] Failed to recover missing sent message", {
            chatId: activeChatId,
            messageId,
            attempt,
            trigger,
            error: errorMessage,
          });
        });
    },
    [
      clearPendingUserMessageFallback,
      onError,
      readOnly,
      updateMessagesState,
      utils,
    ]
  );
  const flushPendingUserMessageFallbacks = useCallback(() => {
    const activeChatId = activeChatIdRef.current;
    if (!activeChatId || readOnly) {
      clearAllPendingUserMessageFallbacks();
      return;
    }
    for (const [messageId, timer] of pendingUserMessageFallbackTimersRef.current) {
      clearTimeout(timer);
      pendingUserMessageFallbackTimersRef.current.delete(messageId);
      recoverMissingSentMessage(activeChatId, messageId, 1, "chat_finish");
    }
  }, [
    clearAllPendingUserMessageFallbacks,
    readOnly,
    recoverMissingSentMessage,
  ]);
  const schedulePendingUserMessageFallback = useCallback(
    (activeChatId: string, messageId: string) => {
      clearPendingUserMessageFallback(messageId);
      const timer = setTimeout(() => {
        pendingUserMessageFallbackTimersRef.current.delete(messageId);
        recoverMissingSentMessage(activeChatId, messageId, 1, "initial");
      }, USER_MESSAGE_FALLBACK_TIMEOUT_MS);
      pendingUserMessageFallbackTimersRef.current.set(messageId, timer);
    },
    [clearPendingUserMessageFallback, recoverMissingSentMessage]
  );
  // Mutations
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const setConfigOptionMutation = trpc.setConfigOption.useMutation();
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const permissionResponseMutation =
    trpc.respondToPermissionRequest.useMutation();
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
      onCommandsChange: setCommands,
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
  const loadHistory = useCallback(
    async (force = false) => {
      const activeChatId = chatId ?? null;
      if (!activeChatId || readOnly || isResumingRef.current) {
        return;
      }
      if (historyLoadingRef.current) {
        return;
      }
      if (!force && historyAppliedRef.current) {
        return;
      }
      if (connStatus !== "connecting" && connStatus !== "connected") {
        return;
      }

      const loadVersion = historyLoadVersionRef.current + 1;
      historyLoadVersionRef.current = loadVersion;
      historyLoadingRef.current = true;
      try {
        let cursor: number | undefined;
        let mergedMessageCount = 0;
        const seenCursors = new Set<number>();
        while (historyLoadVersionRef.current === loadVersion) {
          const page = await utils.getSessionMessagesPage.fetch({
            chatId: activeChatId,
            cursor,
            includeCompacted: true,
          });
          const normalizedPageMessages = normalizeMessages(page.messages);
          if (normalizedPageMessages.length > 0) {
            mergedMessageCount += normalizedPageMessages.length;
            updateMessagesState((prev) =>
              mergeMessagesIntoState(prev, normalizedPageMessages)
            );
          }
          if (!page.hasMore || page.nextCursor === undefined) {
            break;
          }
          if (seenCursors.has(page.nextCursor)) {
            console.warn("Detected repeated history cursor, stopping pagination", {
              chatId: activeChatId,
              cursor: page.nextCursor,
            });
            break;
          }
          seenCursors.add(page.nextCursor);
          cursor = page.nextCursor;
        }

        const currentStatus = statusRef.current;
        if (
          historyLoadVersionRef.current === loadVersion &&
          mergedMessageCount === 0 &&
          (currentStatus === "ready" || isChatBusyStatus(currentStatus))
        ) {
          const recoveryPage = await utils.getSessionMessagesPage.fetch({
            chatId: activeChatId,
            includeCompacted: true,
          });
          const normalizedRecoveryMessages = normalizeMessages(
            recoveryPage.messages
          );
          if (normalizedRecoveryMessages.length > 0) {
            updateMessagesState((prev) =>
              mergeMessagesIntoState(prev, normalizedRecoveryMessages)
            );
          }
        }

        if (historyLoadVersionRef.current === loadVersion) {
          historyAppliedRef.current = true;
        }
      } catch (historyError) {
        if (historyLoadVersionRef.current !== loadVersion) {
          return;
        }
        const message =
          historyError instanceof Error
            ? historyError.message
            : "Failed to load session history";
        console.error("Failed to load chat history", historyError);
        setError(message);
        onError?.(message);
      } finally {
        if (historyLoadVersionRef.current === loadVersion) {
          historyLoadingRef.current = false;
        }
      }
    },
    [chatId, connStatus, onError, readOnly, updateMessagesState, utils]
  );
  const refreshHistory = useCallback(async () => {
    await loadHistory(true);
  }, [loadHistory]);

  // Load stored history once, merging pages by message.id
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const previous = previousStreamLifecycleRef.current;
    if (previous === "recovering" && streamLifecycle === "live") {
      void loadHistory(true);
    }
    previousStreamLifecycleRef.current = streamLifecycle;
  }, [loadHistory, streamLifecycle]);

  // Apply session state when loaded
  useEffect(() => {
    const activeChatId = chatId ?? null;
    if (!activeChatId || !sessionState || connStatus === "idle") {
      return;
    }
    const normalizedSessionState = normalizeSessionStateData(
      sessionState as RawSessionStateData
    );
    if (normalizedSessionState.status === "stopped") {
      setLoadSessionSupported(normalizedSessionState.loadSessionSupported ?? false);
      restoreSessionState(normalizedSessionState);
      isResumingRef.current = false;
      return;
    }
    restoreSessionState(normalizedSessionState);
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
        if (event.type === "ui_message") {
          console.debug("[Chat] Received ui_message", {
            chatId: activeChatIdRef.current,
            messageId: event.message.id,
            partsCount: event.message.parts.length,
            knownMessages: messageStateRef.current.order.length,
          });
        } else if (event.type === "ui_message_delta") {
          const baseMessage = messageStateRef.current.byId.get(event.messageId);
          const deltaTargetPart = baseMessage?.parts[event.partIndex];
          const hasPart =
            deltaTargetPart?.type === "text" ||
            deltaTargetPart?.type === "reasoning";
          console.debug("[Chat] Received ui_message_delta", {
            chatId: activeChatIdRef.current,
            messageId: event.messageId,
            partIndex: event.partIndex,
            deltaLength: event.delta.length,
            hasBaseMessage: Boolean(baseMessage),
            hasPart,
            knownMessages: messageStateRef.current.order.length,
          });
        }
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
      processSessionEvent(
        event,
        getOrderedMessages(messageStateRef.current),
        modesRef.current,
        {
          onStatusChange: setStatus,
          onConnStatusChange: setConnStatus,
          onMessageUpsert: (message) => {
            const normalizedMessage = normalizeMessage(message);
            updateMessagesState((prev) =>
              upsertMessageIntoState(prev, normalizedMessage)
            );
          },
          getMessageById: (messageId) =>
            messageStateRef.current.byId.get(messageId),
          onModesChange: (m) => {
            setModes(m);
            modesRef.current = m;
          },
          onCommandsChange: setCommands,
          onConfigOptionsChange: setConfigOptions,
          onSessionInfoChange: setSessionInfo,
          onTerminalOutput: (terminalId, data) => {
            setTerminalOutputs((prev) => ({
              ...prev,
              [terminalId]: (prev[terminalId] || "") + data,
            }));
          },
          onError: (err) => {
            setError(err);
            setStatus("error");
            onError?.(err);
          },
          onFinish,
        }
      );
      if (event.type === "chat_finish" && messageStateRef.current.order.length === 0) {
        void loadHistory(true);
      }
      if (event.type === "chat_finish") {
        const activeTurnId = activeTurnIdRef.current;
        if (!event.turnId || !activeTurnId || activeTurnId === event.turnId) {
          activeTurnIdRef.current = null;
        }
      }
      if (
        event.type === "chat_status" &&
        event.status === "ready" &&
        (!event.turnId || activeTurnIdRef.current === event.turnId)
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
      flushPendingUserMessageFallbacks,
      isTurnMatched,
      loadHistory,
      onFinish,
      onError,
      updateMessagesState,
    ]
  );
  // Subscription
  const subscriptionEnabled = !!chatId && !readOnly && streamLifecycle !== "idle";
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
          console.error("[Client] Dropped invalid session event", {
            error: message,
          });
          setConnStatus("error");
          setError(message);
          setStatus("error");
          onError?.(message);
        }
      },
      onError(err) {
        console.error("[Client] Subscription error:", err);
        clearAllPendingUserMessageFallbacks();
        setStreamLifecycle((prev) => nextLifecycleOnSubscriptionError(prev));
        setConnStatus("connecting");
        setError(err.message);
        setStatus("error");
      },
    }
  );
  // Actions
  const sendMessage = useCallback(
    async (
      text: string,
      messageOptions?: {
        images?: { base64: string; mimeType: string }[];
        resources?: { uri: string; text: string; mimeType?: string }[];
        resourceLinks?: { uri: string; name: string; mimeType?: string }[];
      }
    ) => {
      if (!chatId) {
        return false;
      }
      setStatus("submitted");
      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId,
          text,
          images: messageOptions?.images,
          resources: messageOptions?.resources,
          resourceLinks: messageOptions?.resourceLinks,
        });
        activeTurnIdRef.current = res.turnId ?? activeTurnIdRef.current;
        schedulePendingUserMessageFallback(chatId, res.userMessageId);
        return res.status === "submitted";
      } catch (sendError) {
        console.error("Failed to send message", sendError);
        setConnStatus("error");
        setStatus("error");
        setError((sendError as Error).message);
        activeTurnIdRef.current = null;
        return false;
      }
    },
    [chatId, schedulePendingUserMessageFallback, sendMessageMutation]
  );
  const cancelPrompt = useCallback(async () => {
    if (!chatId) {
      return;
    }
    const previousStatus = status;
    setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId });
    } catch (cancelError) {
      console.error("Failed to cancel prompt", cancelError);
      setError((cancelError as Error).message);
      setStatus(previousStatus);
    }
  }, [chatId, cancelPromptMutation, status]);
  const setMode = useCallback(
    async (modeId: string) => {
      if (!chatId) {
        return;
      }
      try {
        await setModeMutation.mutateAsync({ chatId, modeId });
        setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev));
      } catch (modeError) {
        console.error("Failed to set mode", modeError);
        setError((modeError as Error).message);
      }
    },
    [chatId, setModeMutation]
  );
  const setModel = useCallback(
    async (modelId: string) => {
      if (!chatId) {
        return;
      }
      try {
        console.info("[Chat] setModel requested", { chatId, modelId });
        await setModelMutation.mutateAsync({ chatId, modelId });
        setModels((prev) =>
          prev ? { ...prev, currentModelId: modelId } : prev
        );
        const modelName =
          models?.availableModels.find((model) => model.modelId === modelId)
            ?.name ?? modelId;
        toast.success(`Model switched to ${modelName}`);
        console.info("[Chat] setModel succeeded", { chatId, modelId });
      } catch (modelError) {
        const message = (modelError as Error).message || "Failed to set model";
        const normalized = message.toLowerCase();
        if (
          normalized.includes("model switching") ||
          normalized.includes("method not found")
        ) {
          setSupportsModelSwitching(false);
        }
        console.error("[Chat] setModel failed", { chatId, modelId, error: message });
        setError(message);
      }
    },
    [chatId, setModelMutation, models]
  );
  const setConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!chatId) {
        return;
      }
      try {
        const result = await setConfigOptionMutation.mutateAsync({
          chatId,
          configId,
          value,
        });
        if (Array.isArray(result?.configOptions)) {
          setConfigOptions(result.configOptions);
        } else {
          setConfigOptions((prev) =>
            prev.map((option) =>
              option.id === configId
                ? { ...option, currentValue: value }
                : option
            )
          );
        }
      } catch (configError) {
        console.error("Failed to set config option", configError);
        setError((configError as Error).message);
      }
    },
    [chatId, setConfigOptionMutation]
  );
  const respondToPermission = useCallback(
    async (requestId: string, decision: string) => {
      if (!chatId) {
        return;
      }
      try {
        await permissionResponseMutation.mutateAsync({
          chatId,
          requestId,
          decision,
        });
        setPendingPermission(null);
      } catch (permissionError) {
        console.error("Failed to respond to permission", permissionError);
        setError((permissionError as Error).message);
      }
    },
    [chatId, permissionResponseMutation]
  );
  const stopSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    try {
      clearAllPendingUserMessageFallbacks();
      await stopSessionMutation.mutateAsync({ chatId });
      setStreamLifecycle("idle");
      setConnStatus("idle");
      setStatus("inactive");
      activeTurnIdRef.current = null;
    } catch (stopError) {
      console.error("Failed to stop session", stopError);
      setError((stopError as Error).message);
    }
  }, [chatId, clearAllPendingUserMessageFallbacks, stopSessionMutation]);
  const resumeSession = useCallback(async () => {
    if (!chatId) {
      return;
    }
    try {
      clearAllPendingUserMessageFallbacks();
      isResumingRef.current = true;
      activeTurnIdRef.current = null;
      setStreamLifecycle("bootstrapping");
      setConnStatus("connecting");
      setStatus("connecting");
      const resumeResult = await resumeSessionMutation.mutateAsync({ chatId });
      const alreadyRunning =
        typeof resumeResult === "object" &&
        resumeResult !== null &&
        "alreadyRunning" in resumeResult &&
        Boolean((resumeResult as { alreadyRunning?: boolean }).alreadyRunning);
      let shouldReloadHistory = false;
      const nextState = await utils.getSessionState.fetch({ chatId });
      const normalizedNextState = normalizeSessionStateData(
        nextState as RawSessionStateData
      );
      if (normalizedNextState.status === "stopped") {
        restoreSessionState(normalizedNextState);
        isResumingRef.current = false;
        return;
      }
      if (!alreadyRunning) {
        setMessages([]);
        historyAppliedRef.current = false;
        shouldReloadHistory = true;
      }
      restoreSessionState(normalizedNextState);
      isResumingRef.current = false;
      if (shouldReloadHistory) {
        void loadHistory(true);
      }
    } catch (resumeError) {
      console.error("Failed to resume chat", resumeError);
      setConnStatus("error");
      setStatus("error");
      setError((resumeError as Error).message);
      isResumingRef.current = false;
    }
  }, [
    chatId,
    clearAllPendingUserMessageFallbacks,
    loadHistory,
    resumeSessionMutation,
    restoreSessionState,
    setMessages,
    utils,
  ]);
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
    isSending: sendMessageMutation.isPending,
    isCancelling: cancelPromptMutation.isPending,
    isResuming: resumeSessionMutation.isPending,
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
    // Message mutation
    upsertMessage,
    setMessages,
    // Internal state mutation
    restoreSessionState,
    setConnStatus,
    setStatus,
  };
}
