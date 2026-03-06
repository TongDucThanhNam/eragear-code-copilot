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
  UIMessage,
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
import { normalizeMessage } from "./use-chat-normalize";
import { resolveSessionEventTurnGuard } from "./use-chat-turn-guards";
import type { UseChatOptions } from "./use-chat.types";

interface UseChatSessionEventHandlerParams {
  loadHistory: (force?: boolean) => Promise<void>;
  onFinish?: UseChatOptions["onFinish"];
  onError?: UseChatOptions["onError"];
  updateMessageState: (updater: (prev: MessageState) => MessageState) => void;
  activeChatIdRef: MutableRefObject<string | null>;
  connectedChatIdRef: MutableRefObject<string | null>;
  messageStateRef: MutableRefObject<MessageState>;
  modesRef: MutableRefObject<SessionModeState | null>;
  modelsRef: MutableRefObject<SessionModelState | null>;
  commandsRef: MutableRefObject<AvailableCommand[]>;
  activeTurnIdRef: MutableRefObject<string | null>;
  blockedTurnIdsRef: MutableRefObject<Set<string>>;
  isResumingRef: MutableRefObject<boolean>;
  statusRef: MutableRefObject<ChatStatus>;
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

export function reconcileMessageUpsertAfterStatus(
  state: MessageState,
  message: UIMessage,
  status: ChatStatus
): MessageState {
  const nextMessage = reconcileLateTerminalMessageSnapshot(message, status);
  const nextState = upsertMessageIntoState(state, nextMessage);
  if (
    status !== "ready" &&
    status !== "inactive" &&
    status !== "error"
  ) {
    return nextState;
  }
  if (hasPendingApprovalRequest(nextMessage)) {
    return nextState;
  }
  return finalizeStreamingMessagesInState(nextState);
}

function reconcileLateTerminalMessageSnapshot(
  message: UIMessage,
  status: ChatStatus
): UIMessage {
  if (
    status !== "ready" &&
    status !== "inactive" &&
    status !== "error"
  ) {
    return message;
  }

  const hasPendingApproval = hasPendingApprovalRequest(message);
  if (!hasPendingApproval) {
    return message;
  }

  let changed = false;
  const parts = message.parts.map((part) => {
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
    ) {
      changed = true;
      return {
        ...part,
        state: "done" as const,
      };
    }
    return part;
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    parts,
  };
}

function hasPendingApprovalRequest(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "approval-requested"
  );
}

/**
 * Keep the most recently completed turn id until a new turn starts or the
 * runtime is explicitly torn down. Late same-turn deltas/part updates can
 * still arrive immediately after terminal status events, and clearing too
 * early drops the tail of the assistant response.
 */
export function reconcileActiveTurnIdAfterEvent(params: {
  activeTurnId: string | null;
  event: BroadcastEvent;
}): string | null {
  const { activeTurnId, event } = params;
  if (event.type === "error") {
    return null;
  }
  return activeTurnId;
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
  } = params;

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
      const turnGuard = resolveSessionEventTurnGuard({
        activeTurnId: activeTurnIdRef.current,
        blockedTurnIds: blockedTurnIdsRef.current,
        event,
        isResuming: isResumingRef.current,
        status: statusRef.current,
      });
      if (turnGuard.ignore) {
        chatDebug("stream", "ignored stale session event by turn guard", {
          chatId: activeChatIdRef.current,
          eventType: event.type,
          activeTurnId: activeTurnIdRef.current,
          ...(event.type === "chat_status" || event.type === "chat_finish"
            ? { turnId: event.turnId ?? null }
            : {}),
        });
        return;
      }
      if (
        turnGuard.nextActiveTurnId &&
        activeTurnIdRef.current !== turnGuard.nextActiveTurnId
      ) {
        activeTurnIdRef.current = turnGuard.nextActiveTurnId;
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
              reconcileMessageUpsertAfterStatus(
                prev,
                normalizedMessage,
                statusRef.current
              )
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
            useChatStreamStore
              .getState()
              .appendTerminalOutput(activeChatId, terminalId, data);
          },
          onFileModified: (filePath) => {
            useFileStore.getState().upsertFile(filePath);
          },
          onError: (eventError) => {
            setError(eventError);
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
        event.type === "chat_status" &&
        event.status === "inactive" &&
        !isResumingRef.current
      ) {
        setStreamLifecycle("idle");
        setConnStatus("idle");
      }
      const previousActiveTurnId = activeTurnIdRef.current;
      const nextActiveTurnId = reconcileActiveTurnIdAfterEvent({
        activeTurnId: previousActiveTurnId,
        event,
      });
      if (
        previousActiveTurnId !== nextActiveTurnId ||
        ((event.type === "chat_finish" ||
          (event.type === "chat_status" && event.status === "ready")) &&
          previousActiveTurnId)
      ) {
        chatDebug("stream", "reconciled active turn after session event", {
          chatId: activeChatIdRef.current,
          eventType: event.type,
          previousActiveTurnId,
          nextActiveTurnId,
          ...(event.type === "chat_status"
            ? { status: event.status, turnId: event.turnId ?? null }
            : {}),
          ...(event.type === "chat_finish" ? { turnId: event.turnId ?? null } : {}),
        });
      }
      activeTurnIdRef.current = nextActiveTurnId;
    },
    [
      activeChatIdRef,
      activeTurnIdRef,
      blockedTurnIdsRef,
      commandsRef,
      connectedChatIdRef,
      isResumingRef,
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
      statusRef,
      updateMessageState,
    ]
  );
}
