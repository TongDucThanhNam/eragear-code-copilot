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

function applyMessageDelta(params: {
  message: UIMessage;
  partType: "text" | "reasoning";
  delta: string;
}): UIMessage | null {
  const { message, partType, delta } = params;
  if (!delta) {
    return message;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part?.type !== partType) {
      continue;
    }

    const updatedPart = { ...part, text: `${part.text}${delta}` };
    const updatedParts = [...message.parts];
    updatedParts[index] = updatedPart;
    return {
      ...message,
      parts: updatedParts,
    };
  }

  return null;
}

// ============================================================================
// Event Processing
// ============================================================================

export interface EventProcessingCallbacks {
  onStatusChange?: (status: ChatStatus) => void;
  onConnStatusChange?: (status: ConnectionStatus) => void;
  onMessagesChange?: (messages: UIMessage[]) => void;
  onMessageUpsert?: (message: UIMessage) => void;
  getMessageById?: (messageId: string) => UIMessage | undefined;
  getMessagesForPermission?: () => Iterable<UIMessage>;
  onModesChange?: (modes: SessionModeState | null) => void;
  onModelsChange?: (models: SessionModelState | null) => void;
  onCommandsChange?: (commands: AvailableCommand[]) => void;
  onPromptCapabilitiesChange?: (caps: PromptCapabilities | null) => void;
  onAgentInfoChange?: (info: AgentInfo | null) => void;
  onTerminalOutput?: (terminalId: string, data: string) => void;
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

/**
 * Process a session event and call appropriate callbacks
 */
export function processSessionEvent(
  event: BroadcastEvent,
  currentMessages: UIMessage[],
  currentModes: SessionModeState | null,
  callbacks: EventProcessingCallbacks
): UIMessage[] {
  switch (event.type) {
    case "connected":
      callbacks.onConnStatusChange?.("connected");
      return currentMessages;

    case "chat_status":
      callbacks.onStatusChange?.(event.status);
      return currentMessages;

    case "chat_finish":
      callbacks.onStatusChange?.("ready");
      callbacks.onFinish?.({
        stopReason: event.stopReason,
        finishReason: event.finishReason,
        messageId: event.messageId,
        message:
          event.message ??
          (event.messageId
            ? callbacks.getMessageById?.(event.messageId)
            : undefined),
        isAbort: event.isAbort,
        turnId: event.turnId,
      });
      return currentMessages;

    case "ui_message": {
      const prev =
        callbacks.getMessageById?.(event.message.id) ??
        currentMessages.find((m) => m.id === event.message.id);
      const wasStreaming = prev ? isMessageStreaming(prev) : false;
      const nowStreaming = isMessageStreaming(event.message);

      let newMessages: UIMessage[] | null = null;
      if (callbacks.onMessageUpsert) {
        callbacks.onMessageUpsert(event.message);
      } else {
        newMessages = upsertMessage(currentMessages, event.message);
        callbacks.onMessagesChange?.(newMessages);
      }
      callbacks.onStreamingChange?.(wasStreaming, nowStreaming, event.message);

      // Update pending permission after message change
      if (callbacks.onPendingPermissionChange) {
        const permissionSource =
          callbacks.getMessagesForPermission?.() ??
          (newMessages ?? currentMessages);
        const pendingPermission = findPendingPermission(permissionSource);
        callbacks.onPendingPermissionChange?.(pendingPermission);
      }

      return newMessages ?? currentMessages;
    }

    case "ui_message_delta": {
      const prev =
        callbacks.getMessageById?.(event.messageId) ??
        currentMessages.find((m) => m.id === event.messageId);
      if (!prev) {
        return currentMessages;
      }

      const nextMessage = applyMessageDelta({
        message: prev,
        partType: event.partType,
        delta: event.delta,
      });
      if (!nextMessage) {
        return currentMessages;
      }

      const wasStreaming = isMessageStreaming(prev);
      const nowStreaming = isMessageStreaming(nextMessage);
      let newMessages: UIMessage[] | null = null;

      if (callbacks.onMessageUpsert) {
        callbacks.onMessageUpsert(nextMessage);
      } else {
        newMessages = upsertMessage(currentMessages, nextMessage);
        callbacks.onMessagesChange?.(newMessages);
      }
      callbacks.onStreamingChange?.(wasStreaming, nowStreaming, nextMessage);
      return newMessages ?? currentMessages;
    }

    case "available_commands_update": {
      const commands = (event.availableCommands || []).map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        input: cmd.input === null ? undefined : cmd.input,
      }));
      callbacks.onCommandsChange?.(commands);
      return currentMessages;
    }

    case "current_mode_update": {
      if (currentModes) {
        callbacks.onModesChange?.({
          ...currentModes,
          currentModeId: event.modeId,
        });
      }
      return currentMessages;
    }

    case "terminal_output": {
      if (event.terminalId && event.data) {
        callbacks.onTerminalOutput?.(event.terminalId, event.data);
      }
      return currentMessages;
    }

    case "error":
      callbacks.onConnStatusChange?.("error");
      callbacks.onError?.(event.error);
      return currentMessages;

    case "heartbeat":
      // No action needed
      return currentMessages;

    default:
      return currentMessages;
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
    onCommandsChange?: (commands: AvailableCommand[]) => void;
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
    const commands = data.commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      input: cmd.input === null ? undefined : cmd.input,
    }));
    callbacks.onCommandsChange?.(commands);
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
