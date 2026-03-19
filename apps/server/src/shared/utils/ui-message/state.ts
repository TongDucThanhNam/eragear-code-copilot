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

const DEFAULT_RUNTIME_UI_MESSAGE_LIMIT = 128;

export interface CreateUiMessageStateOptions {
  messageLimit?: number;
}

class RuntimeUiMessageMap extends Map<string, UIMessage> {
  private readonly state: UiMessageState;
  private readonly messageLimit: number;

  constructor(state: UiMessageState, messageLimit: number) {
    super();
    this.state = state;
    this.messageLimit = Math.max(1, Math.trunc(messageLimit));
  }

  override get(key: string): UIMessage | undefined {
    const value = super.get(key);
    if (!value) {
      return undefined;
    }
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: string, value: UIMessage): this {
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    this.prune();
    return this;
  }

  override delete(key: string): boolean {
    const deleted = super.delete(key);
    if (deleted) {
      cleanupMessageIndexes(this.state, key);
    }
    return deleted;
  }

  override clear(): void {
    const keys = [...super.keys()];
    super.clear();
    for (const key of keys) {
      cleanupMessageIndexes(this.state, key);
    }
  }

  private prune(): void {
    while (super.size > this.messageLimit) {
      const evictKey = findOldestEvictableMessageKey(this.state, super.keys());
      if (!evictKey) {
        return;
      }
      this.delete(evictKey);
    }
  }
}

export function createUiMessageState(
  options?: CreateUiMessageStateOptions
): UiMessageState {
  const state = {
    messages: new Map<string, UIMessage>(),
    partIdIndex: new Map<string, Map<number, string>>(),
    toolPartIndex: new Map<
      string,
      { messageId: string; partIndex: number; turnId?: string }
    >(),
    requiresTurnIdForNextAssistantChunk: undefined,
    lastAssistantId: undefined,
  } satisfies Omit<UiMessageState, "messages"> & {
    messages: Map<string, UIMessage>;
  };
  const messageLimit =
    options?.messageLimit ?? DEFAULT_RUNTIME_UI_MESSAGE_LIMIT;
  state.messages = new RuntimeUiMessageMap(state, messageLimit);
  return state;
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
  turnId?: string;
}): { message: UIMessage; part: ToolUIPart } {
  const { state, messageId, part, turnId } = params;
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
          turnId: turnId ?? existing.turnId,
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
    ...(turnId ? { turnId } : {}),
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
    return removeMessagePartAtIndex(state, message, index);
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

export function clearPermissionOptionsPart(params: {
  state: UiMessageState;
  requestId: string;
}): { message: UIMessage; partIndex: number } | null {
  const { state, requestId } = params;
  for (const message of state.messages.values()) {
    const partIndex = message.parts.findIndex((part) => {
      return (
        part.type === "data-permission-options" &&
        typeof part.data === "object" &&
        part.data !== null &&
        (part.data as { requestId?: unknown }).requestId === requestId
      );
    });
    if (partIndex < 0) {
      continue;
    }
    const part = message.parts[partIndex];
    if (!part || part.type !== "data-permission-options") {
      continue;
    }
    const currentData =
      part.data && typeof part.data === "object"
        ? (part.data as Record<string, unknown>)
        : {};
    const scrubbedPart = {
      ...part,
      data: {
        ...currentData,
        options: [],
      },
    } satisfies UIMessage["parts"][number];
    const nextParts = [...message.parts];
    nextParts[partIndex] = scrubbedPart;
    return {
      message: setMessage(state, {
        ...message,
        parts: nextParts,
      }),
      partIndex,
    };
  }
  return null;
}

export function replaceUiMessages(
  state: UiMessageState,
  messages: Iterable<UIMessage>
): void {
  state.messages.clear();
  for (const message of messages) {
    state.messages.set(message.id, message);
  }
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

function removeMessagePartAtIndex(
  state: UiMessageState,
  message: UIMessage,
  partIndex: number
): UIMessage {
  const updatedMessage = setMessage(state, {
    ...message,
    parts: message.parts.filter((_, index) => index !== partIndex),
  });
  shiftPartIndexesAfterRemoval(state, message.id, partIndex);
  return updatedMessage;
}

function shiftPartIndexesAfterRemoval(
  state: UiMessageState,
  messageId: string,
  removedPartIndex: number
): void {
  const partSlots = state.partIdIndex.get(messageId);
  if (partSlots) {
    const nextPartSlots = new Map<number, string>();
    for (const [partIndex, partId] of partSlots) {
      if (partIndex === removedPartIndex) {
        continue;
      }
      nextPartSlots.set(
        partIndex > removedPartIndex ? partIndex - 1 : partIndex,
        partId
      );
    }
    if (nextPartSlots.size > 0) {
      state.partIdIndex.set(messageId, nextPartSlots);
    } else {
      state.partIdIndex.delete(messageId);
    }
  }

  for (const [toolCallId, location] of state.toolPartIndex) {
    if (
      location.messageId !== messageId ||
      location.partIndex <= removedPartIndex
    ) {
      continue;
    }
    state.toolPartIndex.set(toolCallId, {
      ...location,
      partIndex: location.partIndex - 1,
    });
  }
}

function isToolPartWithCallId(
  part: UIMessagePart | undefined,
  toolCallId: string
): part is ToolUIPart {
  return Boolean(
    part && "toolCallId" in part && part.toolCallId === toolCallId
  );
}

function isToolLocationsDataPart(part: UIMessagePart): part is DataUIPart {
  return part.type === "data-tool-locations";
}

function cleanupMessageIndexes(state: UiMessageState, messageId: string): void {
  state.partIdIndex.delete(messageId);
  const toolCallIdsToDelete: string[] = [];
  for (const [toolCallId, location] of state.toolPartIndex) {
    if (location.messageId === messageId) {
      toolCallIdsToDelete.push(toolCallId);
    }
  }
  for (const toolCallId of toolCallIdsToDelete) {
    state.toolPartIndex.delete(toolCallId);
  }
  if (state.currentAssistantId === messageId) {
    state.currentAssistantId = undefined;
  }
  if (state.lastAssistantId === messageId) {
    state.lastAssistantId = undefined;
  }
  if (state.currentUserId === messageId) {
    state.currentUserId = undefined;
    state.currentUserSource = undefined;
  }
}

function findOldestEvictableMessageKey(
  state: UiMessageState,
  keys: IterableIterator<string>
): string | undefined {
  const protectedIds = new Set<string>();
  if (state.currentAssistantId) {
    protectedIds.add(state.currentAssistantId);
  }
  if (state.lastAssistantId) {
    protectedIds.add(state.lastAssistantId);
  }
  if (state.currentUserId) {
    protectedIds.add(state.currentUserId);
  }
  for (const key of keys) {
    if (!protectedIds.has(key)) {
      return key;
    }
  }
  return undefined;
}
