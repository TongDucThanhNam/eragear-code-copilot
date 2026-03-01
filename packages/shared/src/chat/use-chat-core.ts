/**
 * useChat Core Logic
 *
 * Framework-agnostic pure functions for processing chat events and state.
 * Used by both web and native adapters.
 */

import type { UIMessage } from "../ui-message";
import type {
  AgentInfo,
  AvailableCommand,
  BroadcastEvent,
  ChatStatus,
  ConnectionStatus,
  PermissionOptions,
  PermissionRequest,
  PromptCapabilities,
  SessionConfigOption,
  SessionInfo,
  SessionModelState,
  SessionModeState,
} from "./types";
import { isDataPart, isToolPart } from "./types";

// ============================================================================
// Message Streaming Detection
// ============================================================================

/**
 * Check if a message has any streaming parts (text, reasoning, or active tool calls)
 */
export function isMessageStreaming(message: UIMessage): boolean {
  return message.parts.some((part) => {
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
}

/**
 * Check if a chat status represents an active prompt turn.
 */
export function isChatBusyStatus(status: ChatStatus): boolean {
  return (
    status === "submitted" ||
    status === "streaming" ||
    status === "awaiting_permission" ||
    status === "cancelling"
  );
}

// ============================================================================
// Permission Detection
// ============================================================================

interface PermissionOptionsPayload {
  requestId?: string;
  options?: PermissionOptions;
}

/** Regex for extracting tool name from type */
const TOOL_TYPE_REGEX = /^tool-/;

/**
 * Get permission options from a data-permission-options part
 */
export function getPermissionOptions(
  message: UIMessage,
  requestId: string
): PermissionOptions | undefined {
  for (const item of message.parts) {
    if (!isDataPart(item, "data-permission-options")) {
      continue;
    }
    const data = item.data as PermissionOptionsPayload | undefined;
    if (
      typeof data === "object" &&
      data !== null &&
      data.requestId === requestId
    ) {
      return data.options;
    }
  }
  return undefined;
}

/**
 * Find pending permission request in messages
 */
export function findPendingPermission(
  messages: Iterable<UIMessage>
): PermissionRequest | null {
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
          title: part.title ?? part.type.replace(TOOL_TYPE_REGEX, ""),
          input: part.input,
          options: getPermissionOptions(message, requestId),
        };
      }
    }
  }
  return null;
}

// ============================================================================
// Message Upsert
// ============================================================================

/**
 * Upsert a message into the messages array by id
 */
export function upsertMessage(
  messages: UIMessage[],
  next: UIMessage
): UIMessage[] {
  const index = messages.findIndex((m) => m.id === next.id);
  if (index === -1) {
    return [...messages, next];
  }
  const updated = [...messages];
  updated[index] = next;
  return updated;
}

function warnDroppedDelta(params: {
  event: Extract<BroadcastEvent, { type: "ui_message_delta" }>;
  reason: "message_not_found" | "part_not_found";
}): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn("[Chat] Dropped ui_message_delta", {
    reason: params.reason,
    messageId: params.event.messageId,
    partIndex: params.event.partIndex,
    deltaLength: params.event.delta.length,
  });
}

function warnDroppedPart(params: {
  event: Extract<BroadcastEvent, { type: "ui_message_part" }>;
  reason: "message_not_found" | "part_not_found";
}): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn("[Chat] Dropped ui_message_part", {
    reason: params.reason,
    messageId: params.event.messageId,
    partIndex: params.event.partIndex,
    isNew: params.event.isNew,
    partType: params.event.part.type,
  });
}

function applyMessageDelta(params: {
  message: UIMessage;
  partIndex: number;
  delta: string;
}): UIMessage | null {
  const { message, partIndex, delta } = params;
  if (!delta) {
    return message;
  }
  const part = message.parts[partIndex];
  if (!part || (part.type !== "text" && part.type !== "reasoning")) {
    return null;
  }
  const updatedPart = { ...part, text: `${part.text ?? ""}${delta}` };
  const updatedParts = [...message.parts];
  updatedParts[partIndex] = updatedPart;
  return {
    ...message,
    parts: updatedParts,
  };
}

function applyMessagePartUpdate(params: {
  message: UIMessage;
  partIndex: number;
  part: Extract<BroadcastEvent, { type: "ui_message_part" }>["part"];
  isNew: boolean;
}): UIMessage | null {
  const { message, partIndex, part, isNew } = params;
  if (isNew) {
    if (partIndex < 0 || partIndex > message.parts.length) {
      return null;
    }
    const updatedParts = [...message.parts];
    if (partIndex === updatedParts.length) {
      updatedParts.push(part);
    } else {
      updatedParts.splice(partIndex, 0, part);
    }
    return {
      ...message,
      parts: updatedParts,
    };
  }
  const existingPart = message.parts[partIndex];
  if (!existingPart) {
    return null;
  }
  const updatedParts = [...message.parts];
  updatedParts[partIndex] = part;
  return {
    ...message,
    parts: updatedParts,
  };
}

function finalizeToolPartAfterFinish(
  part: Extract<UIMessage["parts"][number], { type: `tool-${string}` }>
) {
  if (
    part.state !== "input-streaming" &&
    part.state !== "input-available" &&
    part.state !== "approval-responded"
  ) {
    return part;
  }

  const withMetadata =
    "callProviderMetadata" in part && part.callProviderMetadata
      ? { callProviderMetadata: part.callProviderMetadata }
      : {};

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    ...(part.title ? { title: part.title } : {}),
    ...(part.providerExecuted !== undefined
      ? { providerExecuted: part.providerExecuted }
      : {}),
    state: "output-available" as const,
    input: part.input ?? null,
    output: null,
    preliminary: true,
    ...withMetadata,
  };
}

function finalizeMessageAfterFinish(message: UIMessage): UIMessage {
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
    if (isToolPart(part)) {
      const nextToolPart = finalizeToolPartAfterFinish(part);
      if (nextToolPart !== part) {
        changed = true;
      }
      return nextToolPart;
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

export function normalizeAvailableCommands(
  commands:
    | Array<{
        name: string;
        description: string;
        input?: { hint: string } | null;
      }>
    | null
    | undefined
): AvailableCommand[] {
  return (commands ?? []).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    input: cmd.input === null ? undefined : cmd.input,
  }));
}

export function areAvailableCommandsEqual(
  left: AvailableCommand[] | null | undefined,
  right: AvailableCommand[] | null | undefined
): boolean {
  const leftCommands = left ?? [];
  const rightCommands = right ?? [];
  if (leftCommands.length !== rightCommands.length) {
    return false;
  }
  for (let i = 0; i < leftCommands.length; i += 1) {
    const leftCommand = leftCommands[i];
    const rightCommand = rightCommands[i];
    if (!(leftCommand && rightCommand)) {
      return false;
    }
    if (
      leftCommand.name !== rightCommand.name ||
      leftCommand.description !== rightCommand.description ||
      leftCommand.input?.hint !== rightCommand.input?.hint
    ) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// Event Processing
// ============================================================================

export interface EventProcessingCallbacks {
  onStatusChange?: (status: ChatStatus) => void;
  onConnStatusChange?: (status: ConnectionStatus) => void;
  onMessagesChange?: (messages: UIMessage[]) => void;
  onMessageUpsert?: (message: UIMessage) => void;
  onMessagePartUpdate?: (payload: {
    messageId: string;
    messageRole: UIMessage["role"];
    partIndex: number;
    part: Extract<BroadcastEvent, { type: "ui_message_part" }>["part"];
    isNew: boolean;
    createdAt?: number;
  }) => void;
  getMessageById?: (messageId: string) => UIMessage | undefined;
  getMessagesForPermission?: () => Iterable<UIMessage>;
  getCommands?: () => AvailableCommand[] | undefined;
  onModesChange?: (modes: SessionModeState | null) => void;
  onModelsChange?: (models: SessionModelState | null) => void;
  onCommandsChange?: (commands: AvailableCommand[]) => void;
  onConfigOptionsChange?: (configOptions: SessionConfigOption[]) => void;
  onSessionInfoChange?: (sessionInfo: SessionInfo | null) => void;
  onPromptCapabilitiesChange?: (caps: PromptCapabilities | null) => void;
  onAgentInfoChange?: (info: AgentInfo | null) => void;
  onTerminalOutput?: (terminalId: string, data: string) => void;
  onFileModified?: (path: string) => void;
  onPendingPermissionChange?: (permission: PermissionRequest | null) => void;
  onError?: (error: string) => void;
  onFinish?: (payload: {
    stopReason: string;
    finishReason: string;
    messageId?: string;
    message?: UIMessage;
    isAbort: boolean;
    turnId?: string;
  }) => void;
  onStreamingChange?: (
    wasStreaming: boolean,
    isStreaming: boolean,
    message: UIMessage
  ) => void;
}

export interface EventProcessingContext {
  currentModes: SessionModeState | null;
  currentModels: SessionModelState | null;
}

function materializeMessages(messages: Iterable<UIMessage>): UIMessage[] {
  return Array.isArray(messages) ? messages : [...messages];
}

function upsertMessageFromCallbackState(
  callbacks: EventProcessingCallbacks,
  nextMessage: UIMessage
): UIMessage[] | null {
  if (!callbacks.onMessagesChange) {
    return null;
  }
  const source = callbacks.getMessagesForPermission?.();
  if (!source) {
    return null;
  }
  const nextMessages = upsertMessage(materializeMessages(source), nextMessage);
  callbacks.onMessagesChange(nextMessages);
  return nextMessages;
}

function findLatestStreamingAssistantMessage(
  messages: Iterable<UIMessage> | undefined
): UIMessage | undefined {
  if (!messages) {
    return undefined;
  }
  let latest: UIMessage | undefined;
  for (const message of messages) {
    if (message.role !== "assistant" || !isMessageStreaming(message)) {
      continue;
    }
    latest = message;
  }
  return latest;
}

/**
 * Process a session event and call appropriate callbacks
 */
export function processSessionEvent(
  event: BroadcastEvent,
  context: EventProcessingContext,
  callbacks: EventProcessingCallbacks
): void {
  switch (event.type) {
    case "connected":
      callbacks.onConnStatusChange?.("connected");
      return;

    case "chat_status":
      callbacks.onStatusChange?.(event.status);
      callbacks.onConnStatusChange?.(
        event.status === "inactive" ? "idle" : "connected"
      );
      return;

    case "chat_finish": {
      const finishMessage =
        event.message ??
        (event.messageId
          ? callbacks.getMessageById?.(event.messageId)
          : undefined) ??
        findLatestStreamingAssistantMessage(
          callbacks.getMessagesForPermission?.()
        );
      const finalizedFinishMessage = finishMessage
        ? finalizeMessageAfterFinish(finishMessage)
        : undefined;
      if (finalizedFinishMessage) {
        if (callbacks.onMessageUpsert) {
          callbacks.onMessageUpsert(finalizedFinishMessage);
        } else {
          upsertMessageFromCallbackState(callbacks, finalizedFinishMessage);
        }
      }
      callbacks.onStatusChange?.("ready");
      callbacks.onFinish?.({
        stopReason: event.stopReason,
        finishReason: event.finishReason,
        messageId: event.messageId,
        message: finalizedFinishMessage,
        isAbort: event.isAbort,
        turnId: event.turnId,
      });
      return;
    }

    case "ui_message": {
      const prev = callbacks.getMessageById?.(event.message.id);
      const wasStreaming = prev ? isMessageStreaming(prev) : false;
      const nowStreaming = isMessageStreaming(event.message);

      let newMessages: UIMessage[] | null = null;
      if (callbacks.onMessageUpsert) {
        callbacks.onMessageUpsert(event.message);
      } else {
        newMessages = upsertMessageFromCallbackState(callbacks, event.message);
      }
      callbacks.onStreamingChange?.(wasStreaming, nowStreaming, event.message);

      // Update pending permission after message change
      if (callbacks.onPendingPermissionChange) {
        const permissionSource =
          callbacks.getMessagesForPermission?.() ?? newMessages ?? [];
        const pendingPermission = findPendingPermission(permissionSource);
        callbacks.onPendingPermissionChange?.(pendingPermission);
      }

      return;
    }

    case "ui_message_delta": {
      const prev = callbacks.getMessageById?.(event.messageId);
      if (!prev) {
        warnDroppedDelta({ event, reason: "message_not_found" });
        return;
      }

      const nextMessage = applyMessageDelta({
        message: prev,
        partIndex: event.partIndex,
        delta: event.delta,
      });
      if (!nextMessage) {
        warnDroppedDelta({ event, reason: "part_not_found" });
        return;
      }

      const wasStreaming = isMessageStreaming(prev);
      const nowStreaming = isMessageStreaming(nextMessage);

      if (callbacks.onMessageUpsert) {
        callbacks.onMessageUpsert(nextMessage);
      } else {
        upsertMessageFromCallbackState(callbacks, nextMessage);
      }
      callbacks.onStreamingChange?.(wasStreaming, nowStreaming, nextMessage);
      return;
    }

    case "ui_message_part": {
      const prev = callbacks.getMessageById?.(event.messageId);
      if (callbacks.onMessagePartUpdate) {
        callbacks.onMessagePartUpdate({
          messageId: event.messageId,
          messageRole: event.messageRole,
          partIndex: event.partIndex,
          part: event.part,
          isNew: event.isNew,
          createdAt: event.createdAt,
        });
        const next = callbacks.getMessageById?.(event.messageId);
        if (prev && next) {
          callbacks.onStreamingChange?.(
            isMessageStreaming(prev),
            isMessageStreaming(next),
            next
          );
        }
        if (callbacks.onPendingPermissionChange) {
          const pendingPermission = findPendingPermission(
            callbacks.getMessagesForPermission?.() ?? []
          );
          callbacks.onPendingPermissionChange(pendingPermission);
        }
        return;
      }

      if (!prev) {
        if (!event.isNew) {
          warnDroppedPart({ event, reason: "message_not_found" });
          return;
        }
        const nextMessage: UIMessage = {
          id: event.messageId,
          role: event.messageRole,
          parts: [event.part],
          ...(typeof event.createdAt === "number"
            ? { createdAt: event.createdAt }
            : {}),
        };
        if (callbacks.onMessageUpsert) {
          callbacks.onMessageUpsert(nextMessage);
        } else {
          upsertMessageFromCallbackState(callbacks, nextMessage);
        }
        callbacks.onStreamingChange?.(
          false,
          isMessageStreaming(nextMessage),
          nextMessage
        );
        if (callbacks.onPendingPermissionChange) {
          const pendingPermission = findPendingPermission(
            callbacks.getMessagesForPermission?.() ?? []
          );
          callbacks.onPendingPermissionChange(pendingPermission);
        }
        return;
      }

      const nextMessage = applyMessagePartUpdate({
        message: prev,
        partIndex: event.partIndex,
        part: event.part,
        isNew: event.isNew,
      });
      if (!nextMessage) {
        warnDroppedPart({ event, reason: "part_not_found" });
        return;
      }
      const wasStreaming = isMessageStreaming(prev);
      const nowStreaming = isMessageStreaming(nextMessage);
      if (callbacks.onMessageUpsert) {
        callbacks.onMessageUpsert(nextMessage);
      } else {
        upsertMessageFromCallbackState(callbacks, nextMessage);
      }
      callbacks.onStreamingChange?.(wasStreaming, nowStreaming, nextMessage);
      if (callbacks.onPendingPermissionChange) {
        const pendingPermission = findPendingPermission(
          callbacks.getMessagesForPermission?.() ?? []
        );
        callbacks.onPendingPermissionChange(pendingPermission);
      }
      return;
    }

    case "available_commands_update": {
      const commands = normalizeAvailableCommands(event.availableCommands);
      if (areAvailableCommandsEqual(callbacks.getCommands?.(), commands)) {
        return;
      }
      callbacks.onCommandsChange?.(commands);
      return;
    }

    case "config_options_update":
      callbacks.onConfigOptionsChange?.(event.configOptions || []);
      return;

    case "session_info_update":
      callbacks.onSessionInfoChange?.(event.sessionInfo ?? null);
      return;

    case "current_mode_update": {
      if (context.currentModes) {
        callbacks.onModesChange?.({
          ...context.currentModes,
          currentModeId: event.modeId,
        });
      }
      return;
    }

    case "current_model_update": {
      if (context.currentModels) {
        callbacks.onModelsChange?.({
          ...context.currentModels,
          currentModelId: event.modelId,
        });
      }
      return;
    }

    case "terminal_output": {
      if (event.terminalId && event.data) {
        callbacks.onTerminalOutput?.(event.terminalId, event.data);
      }
      return;
    }

    case "file_modified":
      callbacks.onFileModified?.(event.path);
      return;

    case "error":
      callbacks.onConnStatusChange?.("error");
      callbacks.onError?.(event.error);
      return;

    case "heartbeat":
      // No action needed
      return;

    default:
      return;
  }
}

// ============================================================================
// Session State Application
// ============================================================================

export interface SessionStateData {
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
  configOptions?: SessionConfigOption[];
  sessionInfo?: SessionInfo | null;
  promptCapabilities?: PromptCapabilities | null;
  loadSessionSupported?: boolean;
  agentInfo?: AgentInfo | null;
}

/**
 * Apply session state to callbacks
 */
export function applySessionState(
  data: SessionStateData,
  callbacks: {
    onStatusChange?: (status: ChatStatus) => void;
    onModesChange?: (modes: SessionModeState | null) => void;
    onModelsChange?: (models: SessionModelState | null) => void;
    onSupportsModelSwitchingChange?: (supported: boolean) => void;
    getCommands?: () => AvailableCommand[] | undefined;
    onCommandsChange?: (commands: AvailableCommand[]) => void;
    onConfigOptionsChange?: (configOptions: SessionConfigOption[]) => void;
    onSessionInfoChange?: (sessionInfo: SessionInfo | null) => void;
    onPromptCapabilitiesChange?: (caps: PromptCapabilities | null) => void;
    onLoadSessionSupportedChange?: (supported: boolean | undefined) => void;
    onAgentInfoChange?: (info: AgentInfo | null) => void;
    onConnStatusChange?: (status: ConnectionStatus) => void;
  }
): boolean {
  if (data.status === "stopped") {
    callbacks.onPromptCapabilitiesChange?.(null);
    callbacks.onConnStatusChange?.("idle");
    callbacks.onStatusChange?.(data.chatStatus ?? "inactive");
    return false;
  }

  if (data.chatStatus) {
    callbacks.onStatusChange?.(data.chatStatus);
  } else if (data.status === "running") {
    callbacks.onStatusChange?.("ready");
  }

  if (data.modes) {
    callbacks.onModesChange?.(data.modes);
  }
  if (data.models) {
    callbacks.onModelsChange?.(data.models);
  }
  if (data.supportsModelSwitching !== undefined) {
    callbacks.onSupportsModelSwitchingChange?.(
      Boolean(data.supportsModelSwitching)
    );
  }
  if (data.commands) {
    const commands = normalizeAvailableCommands(data.commands);
    if (!areAvailableCommandsEqual(callbacks.getCommands?.(), commands)) {
      callbacks.onCommandsChange?.(commands);
    }
  }
  if (data.configOptions) {
    callbacks.onConfigOptionsChange?.(data.configOptions);
  }
  if (data.sessionInfo !== undefined) {
    callbacks.onSessionInfoChange?.(data.sessionInfo);
  }
  if (data.promptCapabilities !== undefined) {
    callbacks.onPromptCapabilitiesChange?.(data.promptCapabilities);
  }
  if (data.loadSessionSupported !== undefined) {
    callbacks.onLoadSessionSupportedChange?.(data.loadSessionSupported);
  }
  if (data.agentInfo !== undefined) {
    callbacks.onAgentInfoChange?.(data.agentInfo);
  }

  callbacks.onConnStatusChange?.("connected");
  return true;
}
