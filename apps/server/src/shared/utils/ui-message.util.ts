import type * as acp from "@agentclientprotocol/sdk";
import type {
  DataUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
  UIMessageRole,
} from "@repo/shared";
import type { Plan, StoredContentBlock, UiMessageState } from "../types/session.types";
import { toStoredToolCallContent } from "./content-block.util";
import { createId } from "./id.util";

const TOOL_FALLBACK_NAME = "tool";
const PLAN_TOOL_CALL_ID = "plan";

export function getPlanToolCallId(chatId: string) {
  return `${PLAN_TOOL_CALL_ID}:${chatId}`;
}

export function createUiMessageState(): UiMessageState {
  return {
    messages: new Map<string, UIMessage>(),
    toolPartIndex: new Map<string, { messageId: string; partIndex: number }>(),
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
    if (part.type === "text" || part.type === "reasoning") {
      if (part.state === "streaming") {
        return { ...part, state: "done" as const };
      }
    }
    return part;
  });
}

export function appendTextPart(
  message: UIMessage,
  text: string,
  state: TextUIPart["state"]
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "text" && last.state === "streaming" && state === "streaming") {
    last.text += text;
    return;
  }
  message.parts.push({ type: "text", text, state });
}

export function appendReasoningPart(
  message: UIMessage,
  text: string,
  state: ReasoningUIPart["state"]
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (
    last?.type === "reasoning" &&
    last.state === "streaming" &&
    state === "streaming"
  ) {
    last.text += text;
    return;
  }
  message.parts.push({ type: "reasoning", text, state });
}

export function appendContentBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: TextUIPart["state"]
) {
  if (block.type === "text") {
    appendTextPart(message, block.text, state);
    return;
  }
  const parts = contentBlockToParts(block);
  if (parts.length > 0) {
    message.parts.push(...parts);
  }
}

export function contentBlockToParts(block: StoredContentBlock): UIMessagePart[] {
  switch (block.type) {
    case "resource_link": {
      const part: SourceUrlUIPart = {
        type: "source-url",
        sourceId: block.uri,
        url: block.uri,
        title: block.title ?? block.name ?? block.uri,
      };
      return [part];
    }
    case "resource": {
      const resource = block.resource;
      const title = resource.uri ?? "Resource";
      const part: SourceDocumentUIPart = {
        type: "source-document",
        sourceId: resource.uri ?? title,
        mediaType: resource.mimeType ?? "text/plain",
        title,
        filename: filenameFromUri(resource.uri),
      };
      const parts: UIMessagePart[] = [part];
      if ("text" in resource && resource.text) {
        const dataPart: DataUIPart = {
          type: "data-resource",
          data: {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        };
        parts.push(dataPart);
      }
      return parts;
    }
    case "image":
    case "audio": {
      const url = block.uri ?? toDataUrl(block.mimeType, block.data);
      if (!url) {
        return [];
      }
      const part: FileUIPart = {
        type: "file",
        mediaType: block.mimeType,
        url,
        filename: filenameFromUri(block.uri),
      };
      return [part];
    }
    default:
      return [];
  }
}

export function buildUserMessageFromBlocks(params: {
  messageId: string;
  contentBlocks: StoredContentBlock[];
}): UIMessage {
  const message: UIMessage = {
    id: params.messageId,
    role: "user",
    parts: [],
  };
  for (const block of params.contentBlocks) {
    appendContentBlock(message, block, "done");
  }
  return message;
}

export function buildAssistantMessageFromBlocks(params: {
  messageId: string;
  contentBlocks: StoredContentBlock[];
  reasoningBlocks?: StoredContentBlock[];
}): UIMessage {
  const message: UIMessage = {
    id: params.messageId,
    role: "assistant",
    parts: [],
  };
  for (const block of params.reasoningBlocks ?? []) {
    if (block.type === "text") {
      appendReasoningPart(message, block.text, "done");
    }
  }
  for (const block of params.contentBlocks) {
    appendContentBlock(message, block, "done");
  }
  return message;
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

export function buildToolPartFromCall(toolCall: acp.ToolCall): ToolUIPart {
  const toolName = normalizeToolName(toolCall.kind ?? toolCall.title ?? TOOL_FALLBACK_NAME);
  const title = toolCall.title ?? toolCall.kind ?? TOOL_FALLBACK_NAME;
  if (toolCall.rawInput !== undefined) {
    return {
      type: toToolPartType(toolName),
      toolCallId: toolCall.toolCallId,
      title,
      state: "input-available",
      input: toolCall.rawInput,
    };
  }
  return {
    type: toToolPartType(toolName),
    toolCallId: toolCall.toolCallId,
    title,
    state: "input-streaming",
    input: undefined,
  };
}

export function buildToolPartForUpdate(params: {
  toolCallId: string;
  toolName?: string;
  title?: string;
  input?: unknown;
  status?: acp.ToolCallStatus | null;
  content?: acp.ToolCallContent[] | null;
  rawOutput?: unknown;
  rawInput?: unknown;
}): ToolUIPart {
  const toolName = normalizeToolName(params.toolName ?? TOOL_FALLBACK_NAME);
  const title = params.title ?? params.toolName ?? TOOL_FALLBACK_NAME;
  const input = resolveToolInput(params.input, params.rawInput);
  const output = normalizeToolOutput(params.content, params.rawOutput);
  if (params.status === "failed") {
    return {
      type: toToolPartType(toolName),
      toolCallId: params.toolCallId,
      title,
      state: "output-error",
      input,
      errorText: stringifyError(params.rawOutput) ?? "Tool call failed",
    };
  }
  if (params.status === "completed" || output !== undefined) {
    return {
      type: toToolPartType(toolName),
      toolCallId: params.toolCallId,
      title,
      state: "output-available",
      input,
      output,
    };
  }
  return {
    type: toToolPartType(toolName),
    toolCallId: params.toolCallId,
    title,
    state: "input-available",
    input,
  };
}

export function buildToolApprovalPart(params: {
  toolCallId: string;
  toolName: string;
  title?: string;
  input?: unknown;
  approvalId: string;
}): ToolUIPart {
  return {
    type: toToolPartType(normalizeToolName(params.toolName)),
    toolCallId: params.toolCallId,
    title: params.title ?? params.toolName,
    state: "approval-requested",
    input: resolveToolInput(params.input),
    approval: { id: params.approvalId },
  };
}

export function buildToolApprovalResponsePart(params: {
  toolCallId: string;
  toolName: string;
  title?: string;
  input?: unknown;
  approvalId: string;
  approved: boolean;
  reason?: string;
}): ToolUIPart {
  if (!params.approved) {
    return {
      type: toToolPartType(normalizeToolName(params.toolName)),
      toolCallId: params.toolCallId,
      title: params.title ?? params.toolName,
      state: "output-denied",
      input: resolveToolInput(params.input),
      approval: {
        id: params.approvalId,
        approved: false,
        reason: params.reason,
      },
    };
  }
  return {
    type: toToolPartType(normalizeToolName(params.toolName)),
    toolCallId: params.toolCallId,
    title: params.title ?? params.toolName,
    state: "approval-responded",
    input: resolveToolInput(params.input),
    approval: {
      id: params.approvalId,
      approved: true,
      reason: params.reason,
    },
  };
}

export function buildPlanToolPart(plan: Plan, toolCallId: string): ToolUIPart {
  return {
    type: toToolPartType("plan"),
    toolCallId,
    title: "Plan",
    state: "output-available",
    input: null,
    output: plan,
  };
}

export function getToolNameFromCall(toolCall: acp.ToolCall): string {
  return toolCall.kind ?? toolCall.title ?? TOOL_FALLBACK_NAME;
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

function normalizeToolName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || TOOL_FALLBACK_NAME;
}

function toToolPartType(name: string): `tool-${string}` {
  return `tool-${name}`;
}

function resolveToolInput(input?: unknown, rawInput?: unknown) {
  if (input !== undefined) {
    return input;
  }
  if (rawInput !== undefined) {
    return rawInput;
  }
  return null;
}

function normalizeToolOutput(
  content?: acp.ToolCallContent[] | null,
  rawOutput?: unknown
): unknown {
  const sanitized = toStoredToolCallContent(content);
  if (sanitized !== undefined) {
    return sanitized;
  }
  return rawOutput;
}

function stringifyError(rawOutput?: unknown) {
  if (!rawOutput) {
    return null;
  }
  if (typeof rawOutput === "string") {
    return rawOutput;
  }
  if (typeof rawOutput === "object" && rawOutput && "error" in rawOutput) {
    const err = (rawOutput as { error?: unknown }).error;
    if (typeof err === "string") {
      return err;
    }
  }
  return null;
}

function filenameFromUri(uri?: string | null): string | undefined {
  if (!uri) {
    return undefined;
  }
  try {
    const parsed = new URL(uri);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1);
  } catch {
    const segments = uri.split("/").filter(Boolean);
    return segments.at(-1);
  }
}

function toDataUrl(mimeType?: string | null, data?: string | null): string | null {
  if (!mimeType || !data) {
    return null;
  }
  return `data:${mimeType};base64,${data}`;
}
