import type * as acp from "@agentclientprotocol/sdk";
import type {
  DataUIPart,
  ToolUIPart,
  UIMessage,
  UIMessageRole,
} from "@repo/shared";
import type { UiMessageState } from "@/shared/types/session.types";
import { createId } from "@/shared/utils/id.util";

export function createUiMessageState(): UiMessageState {
  return {
    messages: new Map<string, UIMessage>(),
    toolPartIndex: new Map<string, { messageId: string; partIndex: number }>(),
    lastAssistantId: undefined,
  };
}

export function getOrCreateAssistantMessage(
  state: UiMessageState,
  messageId?: string
): UIMessage {
  const targetId = messageId ?? state.currentAssistantId ?? createId("msg");
  const message = ensureMessage(state, "assistant", targetId);
  state.currentAssistantId = message.id;
  return message;
}

export function getOrCreateUserMessage(
  state: UiMessageState,
  messageId?: string
): UIMessage {
  const targetId = messageId ?? state.currentUserId ?? createId("msg");
  const message = ensureMessage(state, "user", targetId);
  state.currentUserId = message.id;
  return message;
}

export function finalizeStreamingParts(message: UIMessage) {
  message.parts = message.parts.map((part) => {
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
    ) {
      return { ...part, state: "done" as const };
    }
    return part;
  });
}

export function upsertToolPart(params: {
  state: UiMessageState;
  messageId?: string;
  part: ToolUIPart;
}): { message: UIMessage; part: ToolUIPart } {
  const { state, messageId, part } = params;
  const existing = state.toolPartIndex.get(part.toolCallId);
  if (existing) {
    const existingMessage = state.messages.get(existing.messageId);
    if (existingMessage) {
      existingMessage.parts[existing.partIndex] = part;
      return { message: existingMessage, part };
    }
  }
  const message = getOrCreateAssistantMessage(state, messageId);
  message.parts.push(part);
  state.toolPartIndex.set(part.toolCallId, {
    messageId: message.id,
    partIndex: message.parts.length - 1,
  });
  return { message, part };
}

export function upsertToolLocationsPart(params: {
  state: UiMessageState;
  toolCallId: string;
  locations?: acp.ToolCallLocation[] | null;
  messageId?: string;
}): UIMessage | null {
  const { state, toolCallId, locations, messageId } = params;
  const existing = state.toolPartIndex.get(toolCallId);
  const existingMessage = existing
    ? state.messages.get(existing.messageId)
    : undefined;
  const hasLocations = Array.isArray(locations) && locations.length > 0;

  if (!(existingMessage || hasLocations)) {
    return null;
  }

  const message =
    existingMessage ?? getOrCreateAssistantMessage(state, messageId);
  const index = message.parts.findIndex(
    (part) =>
      part.type === "data-tool-locations" &&
      typeof part.data === "object" &&
      part.data !== null &&
      (part.data as { toolCallId?: string }).toolCallId === toolCallId
  );

  if (!hasLocations) {
    if (index >= 0) {
      message.parts.splice(index, 1);
    }
    return message;
  }

  const dataPart: DataUIPart = {
    type: "data-tool-locations",
    data: {
      toolCallId,
      locations,
    },
  };

  if (index >= 0) {
    message.parts[index] = dataPart;
  } else {
    message.parts.push(dataPart);
  }
  return message;
}

function ensureMessage(
  state: UiMessageState,
  role: UIMessageRole,
  messageId: string
): UIMessage {
  const existing = state.messages.get(messageId);
  if (existing) {
    return existing;
  }
  const message: UIMessage = { id: messageId, role, parts: [] };
  state.messages.set(messageId, message);
  return message;
}
