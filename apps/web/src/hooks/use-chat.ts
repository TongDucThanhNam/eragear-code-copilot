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
  SessionModelState,
  SessionModeState,
  UIMessage,
} from "@repo/shared";
import {
  applySessionState,
  isChatBusyStatus,
  processSessionEvent,
} from "@repo/shared";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

// ============================================================================
// Types
// ============================================================================

export interface UseChatOptions {
  chatId?: string | null;
  readOnly?: boolean;
  onFinish?: (payload: {
    stopReason: string;
    finishReason: string;
    messageId: string;
    message?: UIMessage;
    isAbort: boolean;
  }) => void;
  onError?: (message: string) => void;
}

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
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: () => Promise<void>;

  // Message mutation
  upsertMessage: (message: UIMessage) => void;
  setMessages: (messages: UIMessage[]) => void;

  // Internal state mutation (for integration with existing code)
  restoreSessionState: (state: SessionStateData) => void;
  setConnStatus: (status: ConnectionStatus) => void;
  setStatus: (status: ChatStatus) => void;
}

interface SessionStateData {
  status?: "running" | "stopped";
  chatStatus?: ChatStatus;
  modes?: SessionModeState;
  models?: SessionModelState;
  supportsModelSwitching?: boolean;
  commands?: Array<{
    name: string;
    description: string;
    input?: { hint: string } | null;
  }>;
  promptCapabilities?: PromptCapabilities | null;
  loadSessionSupported?: boolean;
  agentInfo?: AgentInfo | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { chatId, readOnly = false, onFinish, onError } = options;

  const utils = trpc.useUtils();

  // Core state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>(
    chatId && !readOnly ? "connecting" : "inactive"
  );
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(
    chatId && !readOnly ? "connecting" : "idle"
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
  const [promptCapabilities, setPromptCapabilities] =
    useState<PromptCapabilities | null>(null);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loadSessionSupported, setLoadSessionSupported] = useState<
    boolean | undefined
  >(undefined);

  // Refs
  const chatIdRef = useRef<string | null>(chatId || null);
  const messagesRef = useRef<UIMessage[]>([]);
  const modesRef = useRef<SessionModeState | null>(null);
  const isResumingRef = useRef(false);

  // Batched updates for performance
  const batchUpdateQueueRef = useRef<Array<(prev: UIMessage[]) => UIMessage[]>>(
    []
  );
  const batchUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Keep refs in sync
  useEffect(() => {
    chatIdRef.current = chatId || null;
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    modesRef.current = modes;
  }, [modes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }
    };
  }, []);

  // Batch flush
  const flushBatchQueue = useCallback(() => {
    if (batchUpdateQueueRef.current.length === 0) return;

    const updates = batchUpdateQueueRef.current;
    batchUpdateQueueRef.current = [];

    setMessages((prev) => {
      let result = prev;
      for (const updater of updates) {
        result = updater(result);
      }
      messagesRef.current = result;
      return result;
    });
  }, []);

  const updateMessagesState = useCallback(
    (updater: (old: UIMessage[]) => UIMessage[]) => {
      batchUpdateQueueRef.current.push(updater);

      if (batchUpdateTimerRef.current) {
        clearTimeout(batchUpdateTimerRef.current);
      }

      batchUpdateTimerRef.current = setTimeout(() => {
        flushBatchQueue();
      }, 16);
    },
    [flushBatchQueue]
  );

  // Upsert single message
  const upsertMessage = useCallback(
    (next: UIMessage) => {
      updateMessagesState((prev) => {
        const index = prev.findIndex((m) => m.id === next.id);
        if (index === -1) {
          return [...prev, next];
        }
        const updated = [...prev];
        updated[index] = next;
        return updated;
      });
    },
    [updateMessagesState]
  );

  // Mutations
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
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
      enabled: !!chatId && !readOnly && connStatus === "connecting",
      retry: false,
      staleTime: 0,
    }
  );

  const { data: chatHistory } = trpc.getSessionMessages.useQuery(
    { chatId: chatId || "" },
    {
      enabled: !!chatId && !readOnly && connStatus === "connecting",
      retry: false,
      staleTime: 0,
    }
  );

  // Apply session state when loaded
  useEffect(() => {
    if (sessionState && connStatus === "connecting") {
      if (!isResumingRef.current && chatHistory && Array.isArray(chatHistory)) {
        setMessages(chatHistory as UIMessage[]);
        messagesRef.current = chatHistory as UIMessage[];
      }

      if (sessionState.status === "stopped") {
        setLoadSessionSupported(sessionState.loadSessionSupported ?? false);
        restoreSessionState(sessionState);
        isResumingRef.current = false;
        return;
      }

      restoreSessionState(sessionState);
      isResumingRef.current = false;
    }
  }, [sessionState, chatHistory, connStatus, restoreSessionState]);

  // Event handler
  const handleSessionEvent = useCallback(
    (event: BroadcastEvent) => {
      const newMessages = processSessionEvent(
        event,
        messagesRef.current,
        modesRef.current,
        {
          onStatusChange: setStatus,
          onConnStatusChange: setConnStatus,
          onMessagesChange: (msgs) => {
            setMessages(msgs);
            messagesRef.current = msgs;
          },
          onModesChange: (m) => {
            setModes(m);
            modesRef.current = m;
          },
          onCommandsChange: setCommands,
          onTerminalOutput: (terminalId, data) => {
            setTerminalOutputs((prev) => ({
              ...prev,
              [terminalId]: (prev[terminalId] || "") + data,
            }));
          },
          onPendingPermissionChange: setPendingPermission,
          onError: (err) => {
            setError(err);
            setStatus("error");
            onError?.(err);
          },
          onFinish,
        }
      );
      messagesRef.current = newMessages;
    },
    [onFinish, onError]
  );

  // Subscription
  const subscriptionEnabled =
    !!chatId && !readOnly && connStatus === "connected";

  trpc.onSessionEvents.useSubscription(
    { chatId: chatId || "" },
    {
      enabled: subscriptionEnabled,
      onData(event: unknown) {
        handleSessionEvent(event as BroadcastEvent);
      },
      onError(err) {
        console.error("[Client] Subscription error:", err);
        setConnStatus("error");
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
      if (!chatId) return false;
      setStatus("submitted");

      try {
        const res = await sendMessageMutation.mutateAsync({
          chatId,
          text,
          images: messageOptions?.images,
          resources: messageOptions?.resources,
          resourceLinks: messageOptions?.resourceLinks,
        });

        if (res.stopReason === "cancelled") {
          updateMessagesState((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              parts: [{ type: "text", text: "🚫 Generation cancelled." }],
            },
          ]);
        } else if (res.stopReason === "max_tokens") {
          updateMessagesState((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: "assistant",
              parts: [{ type: "text", text: "⚠️ Max tokens reached." }],
            },
          ]);
        }
        return true;
      } catch (e) {
        console.error("Failed to send message", e);
        setConnStatus("error");
        setStatus("error");
        setError((e as Error).message);
        return false;
      }
    },
    [chatId, sendMessageMutation, updateMessagesState]
  );

  const cancelPrompt = useCallback(async () => {
    if (!chatId) return;
    const previousStatus = status;
    setStatus("cancelling");
    try {
      await cancelPromptMutation.mutateAsync({ chatId });
    } catch (e) {
      console.error("Failed to cancel prompt", e);
      setError((e as Error).message);
      setStatus(previousStatus);
    }
  }, [chatId, cancelPromptMutation, status]);

  const setMode = useCallback(
    async (modeId: string) => {
      if (!chatId) return;
      try {
        await setModeMutation.mutateAsync({ chatId, modeId });
        setModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev));
      } catch (e) {
        console.error("Failed to set mode", e);
        setError((e as Error).message);
      }
    },
    [chatId, setModeMutation]
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!chatId) return;
      if (!supportsModelSwitching) {
        const message =
          "Agent does not support runtime model switching (session/set_model is an unstable feature)";
        setError(message);
        throw new Error(message);
      }
      try {
        await setModelMutation.mutateAsync({ chatId, modelId });
        setModels((prev) =>
          prev ? { ...prev, currentModelId: modelId } : prev
        );
      } catch (e) {
        const message = (e as Error).message || "Failed to set model";
        const normalized = message.toLowerCase();
        if (
          normalized.includes("model switching") ||
          normalized.includes("method not found")
        ) {
          setSupportsModelSwitching(false);
        }
        setError(message);
      }
    },
    [chatId, setModelMutation, supportsModelSwitching]
  );

  const respondToPermission = useCallback(
    async (requestId: string, decision: string) => {
      if (!chatId) return;
      try {
        await permissionResponseMutation.mutateAsync({
          chatId,
          requestId,
          decision,
        });
        setPendingPermission(null);
      } catch (e) {
        console.error("Failed to respond to permission", e);
        setError((e as Error).message);
      }
    },
    [chatId, permissionResponseMutation]
  );

  const stopSession = useCallback(async () => {
    if (!chatId) return;
    try {
      await stopSessionMutation.mutateAsync({ chatId });
      setConnStatus("idle");
      setStatus("inactive");
    } catch (e) {
      console.error("Failed to stop session", e);
      setError((e as Error).message);
    }
  }, [chatId, stopSessionMutation]);

  const resumeSession = useCallback(async () => {
    if (!chatId) return;
    try {
      isResumingRef.current = true;
      setConnStatus("connecting");
      setStatus("connecting");
      setMessages([]);
      messagesRef.current = [];

      await resumeSessionMutation.mutateAsync({ chatId });
      const nextState = await utils.getSessionState.fetch({ chatId });

      if (nextState.status === "stopped") {
        restoreSessionState(nextState);
        return;
      }

      restoreSessionState(nextState);
    } catch (e) {
      console.error("Failed to resume chat", e);
      setConnStatus("error");
      setStatus("error");
      setError((e as Error).message);
    }
  }, [
    chatId,
    resumeSessionMutation,
    utils.getSessionState,
    restoreSessionState,
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
    respondToPermission,
    stopSession,
    resumeSession,

    // Message mutation
    upsertMessage,
    setMessages,

    // Internal state mutation
    restoreSessionState,
    setConnStatus,
    setStatus,
  };
}
