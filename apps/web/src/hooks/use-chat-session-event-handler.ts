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
  SupervisorDecisionSummary,
  SupervisorSessionState,
  UIMessage,
} from "@repo/shared";
import {
  findPendingPermission,
  findSessionConfigOption,
  processSessionEvent,
} from "@repo/shared";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { useChatStreamStore } from "@/store/chat-stream-store";
import { useFileStore } from "@/store/file-store";
import type { UseChatOptions } from "./use-chat.types";
import type { StreamLifecycle } from "./use-chat-connection.machine";
import { nextLifecycleOnSubscriptionEvent } from "./use-chat-connection.machine";
import { chatDebug } from "./use-chat-debug";
import {
  applyPartRemoval,
  applyPartUpdate,
  finalizeStreamingMessagesInState,
  getPartUpdateDiagnostics,
  type MessageState,
  messageHasPendingApproval,
  replaceMessagesState,
  upsertMessageIntoState,
} from "./use-chat-message-state";
import { normalizeMessage } from "./use-chat-normalize";
import {
  hasObservedTurnCompletion,
  rememberCompletedTurnId,
  resolveSessionEventTurnGuard,
} from "./use-chat-turn-guards";

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
  configOptionsRef: MutableRefObject<SessionConfigOption[]>;
  commandsRef: MutableRefObject<AvailableCommand[]>;
  activeTurnIdRef: MutableRefObject<string | null>;
  blockedTurnIdsRef: MutableRefObject<Set<string>>;
  completedTurnIdsRef: MutableRefObject<Set<string>>;
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
  setSupervisor: Dispatch<SetStateAction<SupervisorSessionState | null>>;
  lastSupervisorDecisionRef: MutableRefObject<SupervisorDecisionSummary | null>;
}

export function reconcileMessageUpsertAfterStatus(
  state: MessageState,
  message: UIMessage,
  status: ChatStatus
): MessageState {
  const nextMessage = reconcileLateTerminalMessageSnapshot(message, status);
  const nextState = upsertMessageIntoState(state, nextMessage);
  if (status !== "ready" && status !== "inactive" && status !== "error") {
    return nextState;
  }
  // Check ALL messages for pending approval, not just the upserted one.
  // A ui_message event for a *different* message should NOT trigger
  // finalization of a message that is awaiting permission.
  // Note: finalizeStreamingMessagesInState also performs a per-message
  // approval guard, but this early exit avoids unnecessary state cloning
  // for the common single-permission case.
  if (messageHasPendingApproval(nextMessage)) {
    return nextState;
  }
  if (stateHasAnyPendingApproval(nextState)) {
    return nextState;
  }
  return finalizeStreamingMessagesInState(nextState);
}

export function getChatFinishHistoryReloadDecision(params: {
  event: Extract<BroadcastEvent, { type: "chat_finish" }>;
  state: MessageState;
}): {
  shouldReload: boolean;
  reason:
    | "empty_message_state"
    | "missing_embedded_finish_message"
    | "missing_finished_message"
    | null;
  resolvedMessageId: string | null;
} {
  const { event, state } = params;
  const resolvedMessageId = event.message?.id ?? event.messageId ?? null;

  if (state.order.length === 0) {
    return {
      shouldReload: true,
      reason: "empty_message_state",
      resolvedMessageId,
    };
  }

  if (!resolvedMessageId) {
    return {
      shouldReload: false,
      reason: null,
      resolvedMessageId: null,
    };
  }

  if (!state.byId.has(resolvedMessageId)) {
    return {
      shouldReload: true,
      reason: "missing_finished_message",
      resolvedMessageId,
    };
  }

  if (!event.message) {
    return {
      shouldReload: true,
      reason: "missing_embedded_finish_message",
      resolvedMessageId,
    };
  }

  return {
    shouldReload: false,
    reason: null,
    resolvedMessageId,
  };
}

export function shouldFinalizeAfterReadyStatus(params: {
  event: Extract<BroadcastEvent, { type: "chat_status" }>;
  completedTurnIds: ReadonlySet<string>;
}): boolean {
  const { event, completedTurnIds } = params;
  if (event.status !== "ready") {
    return false;
  }
  return !hasObservedTurnCompletion(completedTurnIds, event.turnId ?? null);
}

function reconcileLateTerminalMessageSnapshot(
  message: UIMessage,
  status: ChatStatus
): UIMessage {
  if (status !== "ready" && status !== "inactive" && status !== "error") {
    return message;
  }

  const hasPendingApproval = messageHasPendingApproval(message);
  if (hasPendingApproval) {
    return message;
  }
  return finalizeStreamingMessagesInState(replaceMessagesState([message])).byId.get(
    message.id
  ) ?? message;
}

function stateHasAnyPendingApproval(state: MessageState): boolean {
  for (const message of state.orderedMessages) {
    if (messageHasPendingApproval(message)) {
      return true;
    }
  }
  return false;
}

function getPermissionEventMeta(
  event: BroadcastEvent
): Record<string, unknown> | null {
  if (event.type === "chat_status") {
    if (event.status !== "awaiting_permission") {
      return null;
    }
    return {
      eventType: event.type,
      status: event.status,
      turnId: event.turnId ?? null,
    };
  }

  if (event.type === "ui_message") {
    let requestId: string | null = null;
    let toolCallId: string | null = null;
    let hasPermissionOptions = false;

    for (const part of event.message.parts) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "approval-requested"
      ) {
        const toolPart = part as Extract<
          UIMessage["parts"][number],
          { type: `tool-${string}`; state: "approval-requested" }
        >;
        requestId = toolPart.approval.id;
        toolCallId = toolPart.toolCallId;
      } else if (part.type === "data-permission-options") {
        hasPermissionOptions = true;
      }
    }

    if (!(requestId || hasPermissionOptions)) {
      return null;
    }

    return {
      eventType: event.type,
      messageId: event.message.id,
      messageRole: event.message.role,
      partsCount: event.message.parts.length,
      requestId,
      toolCallId,
      hasPermissionOptions,
      turnId: event.turnId ?? null,
    };
  }

  if (event.type === "ui_message_part") {
    const part = event.part;
    if (
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "approval-requested"
    ) {
      const toolPart = part as Extract<
        UIMessage["parts"][number],
        { type: `tool-${string}`; state: "approval-requested" }
      >;
      return {
        eventType: event.type,
        messageId: event.messageId,
        messageRole: event.messageRole,
        partId: event.partId ?? null,
        partIndex: event.partIndex,
        partType: part.type,
        partState: toolPart.state,
        isNew: event.isNew,
        requestId: toolPart.approval.id,
        toolCallId: toolPart.toolCallId,
        turnId: event.turnId ?? null,
      };
    }
    if (part.type === "data-permission-options") {
      const data = part.data as { requestId?: unknown } | undefined;
      return {
        eventType: event.type,
        messageId: event.messageId,
        messageRole: event.messageRole,
        partId: event.partId ?? null,
        partIndex: event.partIndex,
        partType: part.type,
        isNew: event.isNew,
        requestId: typeof data?.requestId === "string" ? data.requestId : null,
        turnId: event.turnId ?? null,
      };
    }
  }

  return null;
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
    configOptionsRef,
    commandsRef,
    activeTurnIdRef,
    blockedTurnIdsRef,
    completedTurnIdsRef,
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
    setSupervisor,
    lastSupervisorDecisionRef,
  } = params;

  return useCallback(
    (event: BroadcastEvent) => {
      if (
        event.type === "current_mode_update" ||
        event.type === "current_model_update"
      ) {
        const modeState = modesRef.current;
        const modelState = modelsRef.current;
        const configOptions = configOptionsRef.current;
        const isModeEvent = event.type === "current_mode_update";
        const matchingConfigOption = isModeEvent
          ? findSessionConfigOption(configOptions, "mode")
          : findSessionConfigOption(configOptions, "model");
        const missingStateForSelectionEvent =
          (isModeEvent ? !modeState : !modelState) && !matchingConfigOption;
        const meta: Record<string, unknown> =
          isModeEvent
            ? {
                eventType: event.type,
                incomingModeId: event.modeId,
                currentModeId: modeState?.currentModeId ?? null,
                availableModesCount: modeState?.availableModes?.length ?? 0,
                hasModeState: Boolean(modeState),
                hasModeConfigOption: Boolean(matchingConfigOption),
              }
            : {
                eventType: event.type,
                incomingModelId: event.modelId,
                currentModelId: modelState?.currentModelId ?? null,
                availableModelsCount: modelState?.availableModels?.length ?? 0,
                hasModelState: Boolean(modelState),
                hasModelConfigOption: Boolean(matchingConfigOption),
              };
        chatDebug("session-config", "received session selection update", {
          chatId: activeChatIdRef.current,
          ...meta,
        });
        if (missingStateForSelectionEvent) {
          chatDebug(
            "session-config",
            "selection update arrived before state hydration",
            {
              chatId: activeChatIdRef.current,
              ...meta,
            }
          );
        }
        if (import.meta.env.DEV) {
          console.debug("[ACP Session Event] session selection update", {
            chatId: activeChatIdRef.current,
            ...meta,
          });
          if (missingStateForSelectionEvent) {
            console.debug(
              "[ACP Session Event] selection update arrived before state hydration",
              {
                chatId: activeChatIdRef.current,
                ...meta,
              }
            );
          }
        }
      }
      if (
        event.type === "chat_finish" &&
        hasObservedTurnCompletion(
          completedTurnIdsRef.current,
          event.turnId ?? null
        )
      ) {
        chatDebug("stream", "ignored duplicate chat_finish replay", {
          chatId: activeChatIdRef.current,
          turnId: event.turnId ?? null,
          messageId: event.messageId ?? event.message?.id ?? null,
        });
        return;
      }
      const permissionEventMeta = getPermissionEventMeta(event);
      const previousPendingPermission = permissionEventMeta
        ? findPendingPermission(messageStateRef.current.byId.values())
        : null;
      if (
        event.type === "connected" ||
        event.type === "chat_status" ||
        event.type === "ui_message" ||
        event.type === "ui_message_part_removed" ||
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
                hasEmbeddedMessage: Boolean(event.message),
                embeddedPartsCount: event.message?.parts.length ?? 0,
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
          event.type === "ui_message_part_removed" ||
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
          currentConfigOptions: configOptionsRef.current,
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
            updateMessageState((prev) => {
              const nextState = applyPartUpdate(prev, partEvent);
              if (nextState === prev) {
                const diagnostics = getPartUpdateDiagnostics(prev, partEvent);
                const isTextualIgnoredUpdate =
                  partEvent.part.type === "text" ||
                  partEvent.part.type === "reasoning";
                const shouldLogIgnoredUpdate =
                  diagnostics.reason !== "unchanged_or_stale" ||
                  isTextualIgnoredUpdate;
                if (shouldLogIgnoredUpdate) {
                  const meta = {
                    chatId: activeChatIdRef.current,
                    messageId: partEvent.messageId,
                    partIndex: partEvent.partIndex,
                    partId: partEvent.partId ?? null,
                    partType: partEvent.part.type,
                    isNew: partEvent.isNew,
                    status: statusRef.current,
                    ...diagnostics,
                  };
                  chatDebug("stream", "ignored ui_message_part update", {
                    ...meta,
                  });
                }
              } else {
                const isTextualAppliedUpdate =
                  partEvent.part.type === "text" ||
                  partEvent.part.type === "reasoning";
                if (isTextualAppliedUpdate) {
                  const incomingTextLength =
                    "text" in partEvent.part ? partEvent.part.text.length : null;
                  const meta = {
                    chatId: activeChatIdRef.current,
                    messageId: partEvent.messageId,
                    partIndex: partEvent.partIndex,
                    partId: partEvent.partId ?? null,
                    partType: partEvent.part.type,
                    isNew: partEvent.isNew,
                    status: statusRef.current,
                    incomingTextLength,
                  };
                  chatDebug("stream", "applied ui_message_part update", meta);
                }
              }
              if (
                statusRef.current === "ready" ||
                statusRef.current === "inactive" ||
                statusRef.current === "error"
              ) {
                return finalizeStreamingMessagesInState(nextState);
              }
              return nextState;
            });
          },
          onMessagePartRemove: (partEvent) => {
            updateMessageState((prev) => applyPartRemoval(prev, partEvent));
          },
          getMessageById: (messageId) =>
            messageStateRef.current.byId.get(messageId),
          getMessagesForPermission: () => messageStateRef.current.byId.values(),
          onPendingPermissionChange: setPendingPermission,
          onModesChange: (nextModes) => {
            chatDebug("session-config", "applied mode update from event", {
              chatId: activeChatIdRef.current,
              currentModeId: nextModes?.currentModeId ?? null,
              availableModesCount: nextModes?.availableModes?.length ?? 0,
            });
            if (import.meta.env.DEV) {
              console.debug("[ACP Session Event] applied mode update", {
                chatId: activeChatIdRef.current,
                currentModeId: nextModes?.currentModeId ?? null,
                availableModesCount: nextModes?.availableModes?.length ?? 0,
              });
            }
            setModes(nextModes);
            modesRef.current = nextModes;
          },
          onModelsChange: (nextModels) => {
            chatDebug("session-config", "applied model update from event", {
              chatId: activeChatIdRef.current,
              currentModelId: nextModels?.currentModelId ?? null,
              availableModelsCount: nextModels?.availableModels?.length ?? 0,
            });
            if (import.meta.env.DEV) {
              console.debug("[ACP Session Event] applied model update", {
                chatId: activeChatIdRef.current,
                currentModelId: nextModels?.currentModelId ?? null,
                availableModelsCount:
                  nextModels?.availableModels?.length ?? 0,
              });
            }
            setModels(nextModels);
            modelsRef.current = nextModels;
          },
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
          onSupervisorChange: (nextSupervisor) => {
            setSupervisor(nextSupervisor);
          },
          onSupervisorDecision: (decision) => {
            lastSupervisorDecisionRef.current = decision;
          },
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
      if (
        event.type === "chat_status" &&
        shouldFinalizeAfterReadyStatus({
          event,
          completedTurnIds: completedTurnIdsRef.current,
        })
      ) {
        updateMessageState((prev) => finalizeStreamingMessagesInState(prev));
      }
      if (event.type === "chat_finish") {
        rememberCompletedTurnId(completedTurnIdsRef.current, event.turnId ?? null);
        updateMessageState((prev) => finalizeStreamingMessagesInState(prev));
        const reloadDecision = getChatFinishHistoryReloadDecision({
          event,
          state: messageStateRef.current,
        });
        if (reloadDecision.shouldReload) {
          chatDebug("history", "loadHistory(force=true) after chat_finish", {
            chatId: activeChatIdRef.current,
            turnId: event.turnId ?? null,
            messageId: reloadDecision.resolvedMessageId,
            hasEmbeddedMessage: Boolean(event.message),
            reason: reloadDecision.reason,
            localMessageCount: messageStateRef.current.order.length,
          });
          if (import.meta.env.DEV) {
            console.warn("[ACP Session Event] loadHistory(force=true) after chat_finish", {
              chatId: activeChatIdRef.current,
              turnId: event.turnId ?? null,
              messageId: reloadDecision.resolvedMessageId,
              hasEmbeddedMessage: Boolean(event.message),
              reason: reloadDecision.reason,
              localMessageCount: messageStateRef.current.order.length,
            });
          }
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
          ...(event.type === "chat_finish"
            ? { turnId: event.turnId ?? null }
            : {}),
        });
      }
      activeTurnIdRef.current = nextActiveTurnId;
      if (permissionEventMeta) {
        const nextPendingPermission = findPendingPermission(
          messageStateRef.current.byId.values()
        );
        chatDebug("permission", "processed permission-related session event", {
          chatId: activeChatIdRef.current,
          connectedChatId: connectedChatIdRef.current,
          activeTurnId: activeTurnIdRef.current,
          previousPendingRequestId:
            previousPendingPermission?.requestId ?? null,
          nextPendingRequestId: nextPendingPermission?.requestId ?? null,
          messageCount: messageStateRef.current.order.length,
          ...permissionEventMeta,
        });
      }
    },
    [
      activeChatIdRef,
      activeTurnIdRef,
      blockedTurnIdsRef,
      completedTurnIdsRef,
      commandsRef,
      configOptionsRef,
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
      setSupervisor,
      lastSupervisorDecisionRef,
      setStatus,
      setStreamLifecycle,
      statusRef,
      updateMessageState,
    ]
  );
}
