import { createHash } from "node:crypto";
import type { UIMessage, UIMessagePart } from "@repo/shared";
import type { BroadcastEvent } from "@/shared/types/session.types";
import { createId } from "./id.util";

const PART_ID_MAX_LENGTH = 256;
const PART_ID_PATTERN = /^[^\s\u0000-\u001F\u007F]+$/;

const partIdCacheByChat = new Map<string, Map<string, string[]>>();

type UiMessagePartEvent = Extract<BroadcastEvent, { type: "ui_message_part" }>;

type ToolLikePart = Extract<UIMessagePart, { type: `tool-${string}` }>;
type DataLikePart = Extract<UIMessagePart, { type: `data-${string}` }>;

function isValidPartId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= PART_ID_MAX_LENGTH &&
    PART_ID_PATTERN.test(value)
  );
}

function getChatPartIdSlots(chatId: string, messageId: string): string[] {
  let chatCache = partIdCacheByChat.get(chatId);
  if (!chatCache) {
    chatCache = new Map<string, string[]>();
    partIdCacheByChat.set(chatId, chatCache);
  }
  let partIds = chatCache.get(messageId);
  if (!partIds) {
    partIds = [];
    chatCache.set(messageId, partIds);
  }
  return partIds;
}

function hashToken(token: string): string {
  return createHash("sha1").update(token).digest("hex").slice(0, 16);
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
  chatId: string;
  messageId: string;
  partIndex: number;
  isNew: boolean;
  part: UIMessagePart;
  expectedPartCount?: number;
}): string | undefined {
  const { chatId, messageId, partIndex, isNew, part, expectedPartCount } = params;
  if (partIndex < 0) {
    return undefined;
  }
  const slots = getChatPartIdSlots(chatId, messageId);
  if (
    typeof expectedPartCount === "number" &&
    Number.isFinite(expectedPartCount) &&
    expectedPartCount >= 0 &&
    slots.length > expectedPartCount
  ) {
    slots.length = expectedPartCount;
  }

  if (isNew) {
    if (slots.length === expectedPartCount && slots[partIndex]) {
      return slots[partIndex];
    }
    while (slots.length < partIndex) {
      slots.push(createId("part"));
    }
    const nextPartId = createPartId(part);
    if (partIndex <= slots.length) {
      slots.splice(partIndex, 0, nextPartId);
    } else {
      slots[partIndex] = nextPartId;
    }
    return slots[partIndex];
  }

  const existing = slots[partIndex];
  if (existing) {
    return existing;
  }
  const nextPartId = createPartId(part);
  slots[partIndex] = nextPartId;
  return nextPartId;
}

export function buildUiMessagePartEvent(params: {
  chatId: string;
  message: UIMessage;
  partIndex: number;
  isNew: boolean;
}): UiMessagePartEvent | null {
  const { chatId, message, partIndex, isNew } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return null;
  }

  const partId = resolvePartId({
    chatId,
    messageId: message.id,
    partIndex,
    isNew,
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
  };
}

export function ensureUiMessagePartEventPartId(
  chatId: string,
  event: UiMessagePartEvent
): UiMessagePartEvent {
  if (typeof event.partId === "string" && isValidPartId(event.partId)) {
    return event;
  }
  const partId = resolvePartId({
    chatId,
    messageId: event.messageId,
    partIndex: event.partIndex,
    isNew: event.isNew,
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

export function clearUiMessagePartEventCache(chatId: string): void {
  partIdCacheByChat.delete(chatId);
}
