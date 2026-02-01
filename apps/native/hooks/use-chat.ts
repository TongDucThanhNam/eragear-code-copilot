import type {
  DataUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@repo/shared";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useAuthConfigured } from "@/hooks/use-auth-config";
import { type Attachment, buildSendMessagePayload } from "@/lib/attachments";
import { trpc } from "@/lib/trpc";
import { type PermissionRequest, useChatStore } from "@/store/chat-store";

// Session event types (matching server's BroadcastEvent)
type SessionEvent =
  | { type: "connected" }
  | { type: "current_mode_update"; modeId: string }
  | {
      type: "available_commands_update";
      availableCommands: Array<{
        name: string;
        description: string;
        input?: { hint: string } | null;
      }>;
    }
  | { type: "ui_message"; message: UIMessage }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string }
  | { type: "terminal_output"; terminalId: string; data: string };

type PermissionOptionsPayload = {
  requestId?: string;
  options?: PermissionRequest["options"];
};

const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

const isDataPart = (part: UIMessagePart, type: string): part is DataUIPart =>
  part.type === type;

const isMessageStreaming = (message: UIMessage) =>
  message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.state === "streaming";
    }
    if (isToolPart(part)) {
      return (
        part.state === "input-streaming" ||
        part.state === "input-available" ||
        part.state === "approval-requested" ||
        part.state === "approval-responded"
      );
    }
    return false;
  });

const getPermissionOptions = (
  message: UIMessage,
  requestId: string
): PermissionRequest["options"] => {
  const part = message.parts.find(
    (item) =>
      isDataPart(item, "data-permission-options") &&
      typeof item.data === "object" &&
      item.data !== null &&
      (item.data as PermissionOptionsPayload).requestId === requestId
  );
  if (!part || typeof part.data !== "object" || part.data === null) {
    return undefined;
  }
  return (part.data as PermissionOptionsPayload).options;
};

const findPendingPermission = (
  messages: UIMessage[]
): PermissionRequest | null => {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        isToolPart(part) &&
        part.state === "approval-requested" &&
        part.approval
      ) {
        const requestId = part.approval.id;
        return {
          requestId,
          toolCallId: part.toolCallId,
          title: part.title ?? part.type.replace(/^tool-/, ""),
          input: part.input,
          options: getPermissionOptions(message, requestId),
        };
      }
    }
  }
  return null;
};

export function useChat() {
  // Select only what we need for the hook's internal logic (subscription key)
  const activeChatId = useChatStore((s) => s.activeChatId);
  const activeChatIsReadOnly = useChatStore((s) => s.activeChatIsReadOnly);
  const connStatus = useChatStore((s) => s.connStatus);
  const isConfigured = useAuthConfigured();

  const utils = trpc.useUtils();
  const hapticTriggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    hapticTriggeredRef.current = new Set();
  }, [activeChatId]);

  const triggerStreamEndHaptic = useCallback((messageId?: string) => {
    if (Platform.OS === "web") {
      return;
    }
    if (!messageId) {
      return;
    }

    const triggered = hapticTriggeredRef.current;
    if (!triggered.has(messageId)) {
      triggered.add(messageId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  // Mutations
  const stopSessionMutation = trpc.stopSession.useMutation();
  const resumeSessionMutation = trpc.resumeSession.useMutation();
  const sendMessageMutation = trpc.sendMessage.useMutation();
  const setModeMutation = trpc.setMode.useMutation();
  const setModelMutation = trpc.setModel.useMutation();
  const cancelPromptMutation = trpc.cancelPrompt.useMutation();
  const respondToPermissionMutation =
    trpc.respondToPermissionRequest.useMutation();

  // Snapshot state (modes/models/commands) on connect or reconnect
  const sessionStateQuery = trpc.getSessionState.useQuery(
    { chatId: activeChatId || "" },
    {
      enabled:
        isConfigured &&
        !!activeChatId &&
        !activeChatIsReadOnly &&
        connStatus === "connecting",
      retry: false,
    }
  );

  const applySessionState = useCallback(
    (data: NonNullable<typeof sessionStateQuery.data>) => {
      const store = useChatStore.getState();
      if (data.status === "stopped") {
        store.setPromptCapabilities(null);
        store.setConnStatus("idle");
        return;
      }

      if (data.modes) {
        store.setModes(data.modes);
      }
      if (data.models) {
        store.setModels(data.models);
      }
      if (data.supportsModelSwitching !== undefined) {
        store.setSupportsModelSwitching(Boolean(data.supportsModelSwitching));
      }
      if (data.commands) {
        const commands = (data.commands || []).map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input === null ? undefined : cmd.input,
        }));
        store.setCommands(commands);
      }
      if (data.promptCapabilities !== undefined) {
        store.setPromptCapabilities(data.promptCapabilities);
      }
      store.setConnStatus("connected");
    },
    []
  );

  useEffect(() => {
    const data = sessionStateQuery.data;
    if (!data || (connStatus !== "connecting" && connStatus !== "connected")) {
      return;
    }

    applySessionState(data);
  }, [sessionStateQuery.data, connStatus, applySessionState]);

  const syncPendingPermission = useCallback(() => {
    const store = useChatStore.getState();
    const nextPending = findPendingPermission(store.messages);
    store.setPendingPermission(nextPending);
  }, []);

  // Subscription Handler
  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      const store = useChatStore.getState();

      switch (event.type) {
        case "connected":
          store.setConnStatus("connected");
          break;

        case "ui_message": {
          const prev = store.messages.find(
            (message) => message.id === event.message.id
          );
          const wasStreaming = prev ? isMessageStreaming(prev) : false;
          store.upsertMessage(event.message);
          const isStreaming = isMessageStreaming(event.message);
          if (
            wasStreaming &&
            !isStreaming &&
            event.message.role === "assistant"
          ) {
            triggerStreamEndHaptic(event.message.id);
          }
          syncPendingPermission();
          break;
        }

        case "available_commands_update": {
          const commands = (event.availableCommands || []).map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            input: cmd.input === null ? undefined : cmd.input,
          }));
          store.setCommands(commands);
          break;
        }

        case "current_mode_update": {
          const modes = store.modes;
          if (modes) {
            store.setModes({ ...modes, currentModeId: event.modeId });
          }
          break;
        }

        case "terminal_output": {
          const { terminalId, data } = event;
          if (terminalId && data) {
            store.appendTerminalOutput(terminalId, data);
          }
          break;
        }

        case "error":
          store.setError(event.error);
          break;

        default:
          break;
      }
    },
    [syncPendingPermission, triggerStreamEndHaptic]
  );

  // Check if this chat has already failed (prevents infinite loop)
  const isChatFailed = useChatStore((s) => s.isChatFailed);
  const shouldSubscribe =
    !!activeChatId &&
    !activeChatIsReadOnly &&
    !isChatFailed(activeChatId) &&
    connStatus === "connected" &&
    isConfigured;

  // Subscription
  trpc.onSessionEvents.useSubscription(
    { chatId: activeChatId || "" },
    {
      enabled: shouldSubscribe,
      onData: (data) => handleSessionEvent(data as SessionEvent),
      onError(err) {
        console.error("Subscription error:", err);
        const store = useChatStore.getState();
        const message =
          typeof err?.message === "string" ? err.message : "Subscription error";

        if (message.includes("Chat not found") && activeChatId) {
          // Mark this chat as failed to prevent infinite re-subscription
          store.markChatFailed(activeChatId);
          store.setActiveChatId(null);
          store.setConnStatus("idle");
          store.setError(
            "Chat not found. The session may have expired. Please start a new session."
          );
          return;
        }

        store.setConnStatus("error");
        store.setError(message);
      },
    }
  );

  const sendMessage = async (text: string, attachments: Attachment[] = []) => {
    if (!activeChatId) {
      return false;
    }
    const store = useChatStore.getState();

    // Note: We don't add message here. Server will broadcast ui_message events
    // which will be received via subscription and added to store.
    // This ensures consistency between live and replayed messages.

    try {
      const payload = buildSendMessagePayload(text, attachments);
      await sendMessageMutation.mutateAsync({
        chatId: activeChatId,
        ...payload,
      });
      return true;
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
      return false;
    }
  };

  const setMode = async (modeId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await setModeMutation.mutateAsync({ chatId: activeChatId, modeId });
      if (store.modes) {
        store.setModes({ ...store.modes, currentModeId: modeId });
      }
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const setModel = async (modelId: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    if (!store.supportsModelSwitching) {
      const message =
        "Agent does not support runtime model switching (session/set_model is an unstable feature)";
      store.setError(message);
      throw new Error(message);
    }
    try {
      await setModelMutation.mutateAsync({ chatId: activeChatId, modelId });
      if (store.models) {
        store.setModels({ ...store.models, currentModelId: modelId });
      }
    } catch (e) {
      const error = e as Error;
      const message = error?.message || "Failed to set model";
      const normalized = message.toLowerCase();
      if (
        normalized.includes("model switching") ||
        normalized.includes("method not found")
      ) {
        store.setSupportsModelSwitching(false);
      }
      store.setError(message);
    }
  };

  const cancelPrompt = async () => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await cancelPromptMutation.mutateAsync({ chatId: activeChatId });
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const respondToPermission = async (requestId: string, decision: string) => {
    if (!activeChatId) {
      return;
    }
    const store = useChatStore.getState();
    try {
      await respondToPermissionMutation.mutateAsync({
        chatId: activeChatId,
        requestId,
        decision,
      });
      store.setPendingPermission(null);
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
    }
  };

  const stopSession = async () => {
    if (!activeChatId) {
      return;
    }
    await stopSessionMutation.mutateAsync({ chatId: activeChatId });
    useChatStore.getState().setConnStatus("idle");
  };

  const resumeSession = async (chatId: string) => {
    const store = useChatStore.getState();
    try {
      store.setConnStatus("connecting");
      await utils.getSessionState.cancel({ chatId });
      const res = await resumeSessionMutation.mutateAsync({ chatId });
      await utils.getSessionState.invalidate({ chatId });
      const state = await utils.getSessionState.fetch({ chatId });
      applySessionState(state);
      if (res?.promptCapabilities !== undefined) {
        store.setPromptCapabilities(res.promptCapabilities);
      }
      return res;
    } catch (e) {
      const error = e as Error;
      store.setError(error.message);
      store.setConnStatus("error");
      throw e;
    }
  };

  return {
    sendMessage,
    setMode,
    setModel,
    cancelPrompt,
    respondToPermission,
    stopSession,
    resumeSession,
    isResuming: resumeSessionMutation.isPending,
    isSending: sendMessageMutation.isPending,
    isCancelling: cancelPromptMutation.isPending,
  };
}
