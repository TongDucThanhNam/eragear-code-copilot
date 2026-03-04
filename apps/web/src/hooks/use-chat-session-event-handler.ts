import type {
  AvailableCommand,
  BroadcastEvent,
  ChatStatus,
  ConnectionStatus,
  PermissionRequest,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
} from "@repo/shared";
import { processSessionEvent } from "@repo/shared";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback } from "react";
import { useChatStreamStore } from "@/store/chat-stream-store";
import { useFileStore } from "@/store/file-store";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import { nextLifecycleOnSubscriptionEvent } from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";
import {
  applyPartUpdate,
  finalizeStreamingMessagesInState,
  type MessageState,
  upsertMessageIntoState,
} from "./use-chat-message-state";
import { normalizeMessage, shouldLogChatStreamDebug } from "./use-chat-normalize";
import { logChatStreamDebug } from "./use-chat-stream-debug";
import type { UseChatOptions } from "./use-chat.types";

interface UseChatSessionEventHandlerParams {
  loadHistory: (force?: boolean) => Promise<void>;
  onFinish?: UseChatOptions["onFinish"];
  onError?: UseChatOptions["onError"];
  updateMessageState: (updater: (prev: MessageState) => MessageState) => void;
  activeChatIdRef: MutableRefObject<string | null>;
  connectedChatIdRef: MutableRefObject<string | null>;
  messageStateRef: MutableRefObject<MessageState>;
  terminalOutputsRef: MutableRefObject<Record<string, string>>;
  modesRef: MutableRefObject<SessionModeState | null>;
  modelsRef: MutableRefObject<SessionModelState | null>;
  commandsRef: MutableRefObject<AvailableCommand[]>;
  activeTurnIdRef: MutableRefObject<string | null>;
  isResumingRef: MutableRefObject<boolean>;
  setStreamLifecycle: Dispatch<SetStateAction<StreamLifecycle>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setConnStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setPendingPermission: Dispatch<SetStateAction<PermissionRequest | null>>;
  setModes: Dispatch<SetStateAction<SessionModeState | null>>;
  setModels: Dispatch<SetStateAction<SessionModelState | null>>;
  setCommands: Dispatch<SetStateAction<AvailableCommand[]>>;
  setConfigOptions: Dispatch<SetStateAction<SessionConfigOption[]>>;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useChatSessionEventHandler(
  params: UseChatSessionEventHandlerParams
) {
  const {
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
  } = params;

  const isTurnMatched = useCallback(
    (turnId?: string) => {
      if (!turnId) {
        return true;
      }
      const activeTurnId = activeTurnIdRef.current;
      if (!activeTurnId) {
        activeTurnIdRef.current = turnId;
        return true;
      }
      return activeTurnId === turnId;
    },
    [activeTurnIdRef]
  );

  return useCallback(
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
      // Only mark connectedChatIdRef when the event proves a live runtime
      // subscription. "connected" is only emitted for runtime-backed
      // subscriptions (server-side gate). "chat_status" with a non-inactive
      // status also proves live runtime. Do NOT set on inactive chat_status
      // to avoid false-positive gating in ensureLiveSubscription.
      if (event.type === "connected") {
        connectedChatIdRef.current = activeChatIdRef.current;
      } else if (
        event.type === "chat_status" &&
        "status" in event &&
        (event as { status?: string }).status !== "inactive"
      ) {
        connectedChatIdRef.current = activeChatIdRef.current;
      }
      // Any real data event (message, part update, finish) also proves the
      // subscription is live. Keep connectedChatIdRef in sync.
      if (
        !connectedChatIdRef.current &&
        activeChatIdRef.current &&
        (event.type === "ui_message" ||
          event.type === "ui_message_part" ||
          event.type === "chat_finish")
      ) {
        connectedChatIdRef.current = activeChatIdRef.current;
      }
      if (event.type === "chat_finish" && !isTurnMatched(event.turnId)) {
        return;
      }
      if (event.type === "ui_message_delta") {
        chatDebug("stream", "ignored deprecated ui_message_delta event", {
          chatId: activeChatIdRef.current,
          messageId: event.messageId,
          partIndex: event.partIndex,
          deltaLength: event.delta.length,
        });
        return;
      }
      setStreamLifecycle((prev) =>
        nextLifecycleOnSubscriptionEvent({ current: prev, event })
      );
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
          onModesChange: (nextModes) => {
            setModes(nextModes);
            modesRef.current = nextModes;
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
          onError: (eventError) => {
            setError(eventError);
            setStatus("error");
            onError?.(eventError);
          },
          onFinish,
        }
      );
      if (event.type === "chat_status" && event.status === "ready") {
        updateMessageState((prev) => finalizeStreamingMessagesInState(prev));
      }
      if (event.type === "chat_finish") {
        updateMessageState((prev) => finalizeStreamingMessagesInState(prev));
        if (messageStateRef.current.order.length === 0) {
          void loadHistory(true);
        }
      }
      if (event.type === "error") {
        updateMessageState((prev) => finalizeStreamingMessagesInState(prev));
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
      if (
        event.type === "chat_status" &&
        event.status === "inactive" &&
        !isResumingRef.current
      ) {
        setStreamLifecycle("idle");
        setConnStatus("idle");
      }
      if (event.type === "error") {
        activeTurnIdRef.current = null;
      }
    },
    [
      activeChatIdRef,
      activeTurnIdRef,
      commandsRef,
      connectedChatIdRef,
      isResumingRef,
      isTurnMatched,
      loadHistory,
      messageStateRef,
      modelsRef,
      modesRef,
      onError,
      onFinish,
      setCommands,
      setConfigOptions,
      setConnStatus,
      setError,
      setModels,
      setModes,
      setPendingPermission,
      setSessionInfo,
      setStatus,
      setStreamLifecycle,
      terminalOutputsRef,
      updateMessageState,
    ]
  );
}
