import type { UIMessage, UIMessagePart } from "@repo/shared";
import type { FilePart, SourcePart } from "./agentic-message-utils";
import { isDataPart } from "./agentic-message-utils";
import type { UserRenderData } from "./message-item.types";

const PREVIEW_TEXT_LIMIT = 280;

// Format timestamp for messages
export function formatMessageTime(timestamp: number | undefined): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Get timestamp from message — prefer createdAt, then metadata, then now
export function getMessageTimestamp(message: UIMessage): number {
  if (typeof message.createdAt === "number") {
    return message.createdAt;
  }
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.timestamp === "number") {
      return meta.timestamp;
    }
  }
  return Date.now();
}

export const extractMessageText = (parts: UIMessage["parts"]) =>
  parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n");

export const extractUserText = (parts: UIMessage["parts"]) =>
  parts
    .filter(
      (part): part is Extract<UIMessagePart, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n");

export const buildPreviewText = (text: string | null) => {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_TEXT_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, PREVIEW_TEXT_LIMIT).trimEnd()}...`;
};

export const splitUserMessageParts = (
  parts: UIMessage["parts"]
): UserRenderData => {
  const attachments: Array<SourcePart | FilePart> = [];
  const fallbackParts: UIMessagePart[] = [];

  for (const part of parts) {
    if (isDataPart(part)) {
      continue;
    }

    if (
      part.type === "source-url" ||
      part.type === "source-document" ||
      part.type === "file"
    ) {
      attachments.push(part);
      continue;
    }

    if (part.type !== "text") {
      fallbackParts.push(part);
    }
  }

  return {
    attachments,
    fallbackParts,
    text: extractUserText(parts),
  };
};
