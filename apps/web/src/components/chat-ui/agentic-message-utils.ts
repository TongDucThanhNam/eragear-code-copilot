import type { PermissionOption } from "@agentclientprotocol/sdk";
import type {
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@repo/shared";

const FINAL_PART_TYPES = new Set([
  "text",
  "source-url",
  "source-document",
  "file",
]);

export type PermissionEntry = {
  requestId: string;
  options?:
    | PermissionOption[]
    | { allowOther?: boolean; options?: PermissionOption[] };
};

export type SourcePart = Extract<
  UIMessagePart,
  { type: "source-url" | "source-document" }
>;

export type FilePart = Extract<UIMessagePart, { type: "file" }>;

export const isDataPart = (
  part: UIMessagePart
): part is Extract<UIMessagePart, { type: `data-${string}` }> =>
  part.type.startsWith("data-");

const isFinalPart = (
  part: UIMessagePart
): part is TextUIPart | SourcePart | FilePart => FINAL_PART_TYPES.has(part.type);

export const buildPermissionByToolCallId = (parts: UIMessagePart[]) => {
  const permissionByToolCallId = new Map<string, PermissionEntry>();
  for (const part of parts) {
    if (part.type !== "data-permission-options") {
      continue;
    }
    const data = part.data as
      | {
          requestId?: string;
          toolCallId?: string;
          options?:
            | PermissionOption[]
            | { allowOther?: boolean; options?: PermissionOption[] };
        }
      | undefined;
    if (data?.requestId && data.toolCallId) {
      permissionByToolCallId.set(data.toolCallId, {
        requestId: data.requestId,
        options: data.options,
      });
    }
  }
  return permissionByToolCallId;
};

const mergeTextParts = (parts: TextUIPart[]) => {
  const content = parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return content.length > 0 ? content : null;
};

export const splitMessageParts = (parts: UIMessagePart[]) => {
  const displayParts = parts.filter((part) => !isDataPart(part));
  let trailingStart = displayParts.length;
  for (let i = displayParts.length - 1; i >= 0; i -= 1) {
    if (isFinalPart(displayParts[i])) {
      trailingStart = i;
      continue;
    }
    break;
  }
  const chainItems = displayParts.slice(0, trailingStart);
  const finalItems = displayParts.slice(trailingStart);
  const finalText = mergeTextParts(
    finalItems.filter(
      (part): part is TextUIPart => part.type === "text"
    )
  );
  const finalAttachments = finalItems.filter(
    (part): part is SourcePart | FilePart => part.type !== "text"
  );

  return { chainItems, finalText, finalAttachments };
};

export type ToolViewState =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "approval-requested";

export const toToolViewState = (tool: ToolUIPart): ToolViewState => {
  switch (tool.state) {
    case "input-streaming":
      return "pending";
    case "input-available":
      return "running";
    case "approval-requested":
      return "approval-requested";
    case "approval-responded":
      return "running";
    case "output-available":
      return "completed";
    case "output-error":
    case "output-denied":
      return "error";
    default:
      return "pending";
  }
};

const isToolActive = (tool: ToolUIPart) =>
  tool.state !== "output-available" &&
  tool.state !== "output-error" &&
  tool.state !== "output-denied";

const isPartActive = (part: UIMessagePart) => {
  if (part.type === "text" || part.type === "reasoning") {
    return part.state === "streaming";
  }
  if (part.type.startsWith("tool-")) {
    return isToolActive(part as ToolUIPart);
  }
  return false;
};

export const getActiveIndex = (parts: UIMessagePart[]) => {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isPartActive(parts[i])) {
      return i;
    }
  }
  return -1;
};

export const isMessageStreaming = (parts: UIMessagePart[]) =>
  parts.some((part) => isPartActive(part));

export const buildMessageCopyText = (message: UIMessage) => {
  const textParts = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);

  return textParts.join("\n\n");
};

export const getPartKey = (part: UIMessagePart, index: number) => {
  if (part.type.startsWith("tool-")) {
    return `tool-${(part as ToolUIPart).toolCallId}`;
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `source-${part.sourceId}`;
  }
  if (part.type === "file") {
    return `file-${part.url}`;
  }
  if (part.type === "reasoning") {
    return `reasoning-${index}`;
  }
  if (part.type === "text") {
    return `text-${index}`;
  }
  return `part-${index}`;
};
