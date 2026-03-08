import { createHash } from "node:crypto";
import type { UIMessage, UIMessagePart } from "@repo/shared";
import type {
  BroadcastEvent,
  UiMessageState,
} from "@/shared/types/session.types";
import { createId } from "./id.util";

const PART_ID_MAX_LENGTH = 256;
const PART_ID_PATTERN = /^[^\s\u0000-\u001F\u007F]+$/;
const PART_ID_INDEX_MIN_LIMIT = 32;
const PART_ID_INDEX_HEADROOM = 16;

type UiMessagePartEvent = Extract<BroadcastEvent, { type: "ui_message_part" }>;
type UiMessagePartRemovedEvent = Extract<
  BroadcastEvent,
  { type: "ui_message_part_removed" }
>;

type ToolLikePart = Extract<UIMessagePart, { type: `tool-${string}` }>;
type DataLikePart = Extract<UIMessagePart, { type: `data-${string}` }>;

function isValidPartId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= PART_ID_MAX_LENGTH &&
    PART_ID_PATTERN.test(value)
  );
}

function getMessagePartIdSlots(state: UiMessageState, messageId: string) {
  const existing = state.partIdIndex.get(messageId);
  if (existing) {
    state.partIdIndex.delete(messageId);
    state.partIdIndex.set(messageId, existing);
    return existing;
  }
  prunePartIdIndex(state);
  const partIds = new Map<number, string>();
  state.partIdIndex.set(messageId, partIds);
  return partIds;
}

function prunePartIdIndex(state: UiMessageState): void {
  const maxEntries = Math.max(
    PART_ID_INDEX_MIN_LIMIT,
    state.messages.size + PART_ID_INDEX_HEADROOM
  );

  for (const messageId of [...state.partIdIndex.keys()]) {
    if (state.messages.has(messageId)) {
      continue;
    }
    state.partIdIndex.delete(messageId);
  }

  while (state.partIdIndex.size >= maxEntries) {
    const oldestMessageId = state.partIdIndex.keys().next().value;
    if (typeof oldestMessageId !== "string") {
      return;
    }
    state.partIdIndex.delete(oldestMessageId);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function readPartRecordId(part: UIMessagePart): string | undefined {
  const id = (part as { id?: unknown }).id;
  if (typeof id === "string" && isValidPartId(id)) {
    return id;
  }
  return undefined;
}

function isToolPart(part: UIMessagePart): part is ToolLikePart {
  return part.type.startsWith("tool-");
}

function isDataPart(part: UIMessagePart): part is DataLikePart {
  return part.type.startsWith("data-");
}

function readPartIntrinsicId(part: UIMessagePart): string | undefined {
  const existingId = readPartRecordId(part);
  if (existingId) {
    return existingId;
  }

  if (isToolPart(part)) {
    return `tool:${hashToken(part.toolCallId)}`;
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `source:${hashToken(part.sourceId)}`;
  }
  if (part.type === "file") {
    return `file:${hashToken(part.url)}`;
  }
  if (part.type === "data-tool-locations") {
    const data = part.data as { toolCallId?: unknown };
    if (typeof data?.toolCallId === "string" && data.toolCallId.length > 0) {
      return `tool-locations:${hashToken(data.toolCallId)}`;
    }
  }
  if (part.type === "data-permission-options") {
    const data = part.data as { requestId?: unknown };
    if (typeof data?.requestId === "string" && data.requestId.length > 0) {
      return `permission:${hashToken(data.requestId)}`;
    }
  }
  if (isDataPart(part) && typeof part.id === "string") {
    return `data:${hashToken(part.id)}`;
  }

  return undefined;
}

function createPartId(part: UIMessagePart): string {
  return readPartIntrinsicId(part) ?? createId("part");
}

function resolvePartId(params: {
  state: UiMessageState;
  messageId: string;
  partIndex: number;
  part: UIMessagePart;
  expectedPartCount?: number;
}): string | undefined {
  const { state, messageId, partIndex, part, expectedPartCount } = params;
  if (partIndex < 0) {
    return undefined;
  }
  const slots = getMessagePartIdSlots(state, messageId);
  if (
    typeof expectedPartCount === "number" &&
    Number.isFinite(expectedPartCount) &&
    expectedPartCount >= 0
  ) {
    const staleIndexes: number[] = [];
    for (const existingPartIndex of slots.keys()) {
      if (existingPartIndex >= expectedPartCount) {
        staleIndexes.push(existingPartIndex);
      }
    }
    for (const staleIndex of staleIndexes) {
      slots.delete(staleIndex);
    }
  }

  const intrinsicPartId = readPartIntrinsicId(part);
  if (intrinsicPartId) {
    for (const [existingIndex, existingPartId] of slots) {
      if (existingPartId !== intrinsicPartId) {
        continue;
      }
      if (existingIndex !== partIndex) {
        slots.delete(existingIndex);
        slots.set(partIndex, existingPartId);
      }
      return existingPartId;
    }
  }

  const existing = slots.get(partIndex);
  if (existing) {
    return existing;
  }
  const nextPartId = intrinsicPartId ?? createPartId(part);
  slots.set(partIndex, nextPartId);
  return nextPartId;
}

export function buildUiMessagePartEvent(params: {
  state: UiMessageState;
  message: UIMessage;
  partIndex: number;
  isNew: boolean;
  turnId?: string;
}): UiMessagePartEvent | null {
  const { state, message, partIndex, isNew, turnId } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return null;
  }

  const partId = resolvePartId({
    state,
    messageId: message.id,
    partIndex,
    part,
    expectedPartCount: message.parts.length,
  });
  if (!partId) {
    return null;
  }

  return {
    type: "ui_message_part",
    messageId: message.id,
    messageRole: message.role,
    partId,
    partIndex,
    part,
    isNew,
    ...(typeof message.createdAt === "number"
      ? { createdAt: message.createdAt }
      : {}),
    ...(turnId ? { turnId } : {}),
  };
}

export function buildUiMessagePartRemovedEvent(params: {
  state: UiMessageState;
  message: UIMessage;
  partIndex: number;
  turnId?: string;
}): UiMessagePartRemovedEvent | null {
  const { state, message, partIndex, turnId } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return null;
  }

  const partId = resolvePartId({
    state,
    messageId: message.id,
    partIndex,
    part,
    expectedPartCount: message.parts.length,
  });

  return {
    type: "ui_message_part_removed",
    messageId: message.id,
    messageRole: message.role,
    partId,
    partIndex,
    part,
    ...(turnId ? { turnId } : {}),
  };
}

export function ensureUiMessagePartEventPartId(
  state: UiMessageState,
  event: UiMessagePartEvent
): UiMessagePartEvent {
  if (typeof event.partId === "string" && isValidPartId(event.partId)) {
    return event;
  }
  const partId = resolvePartId({
    state,
    messageId: event.messageId,
    partIndex: event.partIndex,
    part: event.part,
  });
  if (!partId) {
    return event;
  }
  return {
    ...event,
    partId,
  };
}
