import type * as acp from "@agentclientprotocol/sdk";
import type {
  DataUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
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

export function finalizeStreamingParts(message: UIMessage): UIMessage {
  let changed = false;
  const nextParts = message.parts.map((part) => {
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
    ) {
      changed = true;
      return { ...part, state: "done" as const };
    }
    return part;
  });
  if (!changed) {
    return message;
  }
  return {
    ...message,
    parts: nextParts,
  };
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
      let targetPartIndex = existing.partIndex;
      if (
        !isToolPartWithCallId(
          existingMessage.parts[targetPartIndex],
          part.toolCallId
        )
      ) {
        targetPartIndex = existingMessage.parts.findIndex((messagePart) =>
          isToolPartWithCallId(messagePart, part.toolCallId)
        );
      }
      if (targetPartIndex >= 0) {
        const updatedParts = [...existingMessage.parts];
        updatedParts[targetPartIndex] = part;
        const updatedMessage = setMessage(state, {
          ...existingMessage,
          parts: updatedParts,
        });
        state.toolPartIndex.set(part.toolCallId, {
          messageId: updatedMessage.id,
          partIndex: targetPartIndex,
        });
        return { message: updatedMessage, part };
      }
    }
    state.toolPartIndex.delete(part.toolCallId);
  }
  const message = getOrCreateAssistantMessage(state, messageId);
  const updatedMessage = setMessage(state, {
    ...message,
    parts: [...message.parts, part],
  });
  state.toolPartIndex.set(part.toolCallId, {
    messageId: updatedMessage.id,
    partIndex: updatedMessage.parts.length - 1,
  });
  return { message: updatedMessage, part };
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
      isToolLocationsDataPart(part) &&
      typeof part.data === "object" &&
      part.data !== null &&
      (part.data as { toolCallId?: string }).toolCallId === toolCallId
  );

  if (!hasLocations) {
    if (index < 0) {
      return message;
    }
    const updatedMessage = setMessage(state, {
      ...message,
      parts: message.parts.filter((_, partIndex) => partIndex !== index),
    });
    return updatedMessage;
  }

  const dataPart: DataUIPart = {
    type: "data-tool-locations",
    data: {
      toolCallId,
      locations,
    },
  };

  const updatedParts = [...message.parts];
  if (index >= 0) {
    updatedParts[index] = dataPart;
  } else {
    updatedParts.push(dataPart);
  }
  return setMessage(state, {
    ...message,
    parts: updatedParts,
  });
}

function ensureMessage(
  state: UiMessageState,
  role: UIMessageRole,
  messageId: string,
  createdAt = Date.now()
): UIMessage {
  const existing = state.messages.get(messageId);
  if (existing) {
    return existing;
  }
  const message: UIMessage = { id: messageId, role, createdAt, parts: [] };
  state.messages.set(messageId, message);
  return message;
}

function setMessage(state: UiMessageState, message: UIMessage): UIMessage {
  state.messages.set(message.id, message);
  return message;
}

function isToolPartWithCallId(
  part: UIMessagePart | undefined,
  toolCallId: string
): part is ToolUIPart {
  return Boolean(
    part &&
      "toolCallId" in part &&
      part.toolCallId === toolCallId
  );
}

function isToolLocationsDataPart(part: UIMessagePart): part is DataUIPart {
  return part.type === "data-tool-locations";
}
