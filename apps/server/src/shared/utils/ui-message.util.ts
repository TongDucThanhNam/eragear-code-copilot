import type * as acp from "@agentclientprotocol/sdk";
import type {
  DataUIPart,
  FileUIPart,
  ProviderMetadata,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
  UIMessageRole,
} from "@repo/shared";
import type {
  Plan,
  StoredContentBlock,
  UiMessageState,
} from "../types/session.types";
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

export function appendTextPart(
  message: UIMessage,
  text: string,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "text" && last.state === state) {
    last.text += text;
    if (providerMetadata) {
      last.providerMetadata = mergeProviderMetadata(
        last.providerMetadata,
        providerMetadata
      );
    }
    return;
  }
  const part: TextUIPart = providerMetadata
    ? { type: "text", text, state, providerMetadata }
    : { type: "text", text, state };
  message.parts.push(part);
}

export function appendReasoningPart(
  message: UIMessage,
  text: string,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (!text) {
    return;
  }
  const last = message.parts.at(-1);
  if (last?.type === "reasoning") {
    last.text += text;
    last.state = state;
    if (providerMetadata) {
      last.providerMetadata = mergeProviderMetadata(
        last.providerMetadata,
        providerMetadata
      );
    }
    return;
  }
  const part: ReasoningUIPart = providerMetadata
    ? { type: "reasoning", text, state, providerMetadata }
    : { type: "reasoning", text, state };
  message.parts.push(part);
}

export function appendReasoningBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: ReasoningUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (block.type !== "text") {
    return;
  }
  const combinedMetadata = mergeProviderMetadata(
    getBlockProviderMetadata(block),
    providerMetadata
  );
  appendReasoningPart(message, block.text, state, combinedMetadata);
}

export function appendContentBlock(
  message: UIMessage,
  block: StoredContentBlock,
  state: TextUIPart["state"],
  providerMetadata?: ProviderMetadata
) {
  if (block.type === "text") {
    const combinedMetadata = mergeProviderMetadata(
      getBlockProviderMetadata(block),
      providerMetadata
    );
    appendTextPart(message, block.text, state, combinedMetadata);
    return;
  }
  const parts = contentBlockToParts(block, providerMetadata);
  if (parts.length > 0) {
    message.parts.push(...parts);
  }
}

export function contentBlockToParts(
  block: StoredContentBlock,
  providerMetadata?: ProviderMetadata
): UIMessagePart[] {
  switch (block.type) {
    case "resource_link": {
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block),
        providerMetadata
      );
      const part: SourceUrlUIPart = {
        type: "source-url",
        sourceId: block.uri,
        url: block.uri,
        title: block.title ?? block.name ?? block.uri,
        providerMetadata: mergedProviderMetadata,
      };
      return [part];
    }
    case "resource": {
      const resource = block.resource;
      const title = resource.uri ?? "Resource";
      const resourceMeta = getResourceMeta(resource);
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block, resourceMeta),
        providerMetadata
      );
      const part: SourceDocumentUIPart = {
        type: "source-document",
        sourceId: resource.uri ?? title,
        mediaType: resource.mimeType ?? "text/plain",
        title,
        filename: filenameFromUri(resource.uri),
        providerMetadata: mergedProviderMetadata,
      };
      const dataPart = buildResourceDataPart(block, resource);
      return dataPart ? [part, dataPart] : [part];
    }
    case "image":
    case "audio": {
      const uri = "uri" in block ? block.uri : undefined;
      const url = uri ?? toDataUrl(block.mimeType, block.data);
      if (!url) {
        return [];
      }
      const mergedProviderMetadata = mergeProviderMetadata(
        getBlockProviderMetadata(block),
        providerMetadata
      );
      const part: FileUIPart = {
        type: "file",
        mediaType: block.mimeType,
        url,
        filename: filenameFromUri(uri),
        providerMetadata: mergedProviderMetadata,
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
    appendReasoningBlock(message, block, "done");
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

export function buildToolPartFromCall(toolCall: acp.ToolCall): ToolUIPart {
  const toolName = normalizeToolName(
    toolCall.kind ?? toolCall.title ?? TOOL_FALLBACK_NAME
  );
  const title = toolCall.title ?? toolCall.kind ?? TOOL_FALLBACK_NAME;
  const callProviderMetadata = buildProviderMetadata({
    meta: getOptionalMeta(toolCall),
  });
  const resolvedInput = resolveToolInput(undefined, toolCall.rawInput);
  const hasInput = toolCall.rawInput !== undefined;
  const output = normalizeToolOutput(toolCall.content, toolCall.rawOutput);

  if (toolCall.status === "failed") {
    return {
      type: toToolPartType(toolName),
      toolCallId: toolCall.toolCallId,
      title,
      state: "output-error",
      input: resolvedInput,
      errorText: stringifyError(toolCall.rawOutput) ?? "Tool call failed",
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
    };
  }

  if (toolCall.status === "completed" || output !== undefined) {
    return {
      type: toToolPartType(toolName),
      toolCallId: toolCall.toolCallId,
      title,
      state: "output-available",
      input: resolvedInput,
      output,
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
    };
  }

  if (hasInput) {
    return {
      type: toToolPartType(toolName),
      toolCallId: toolCall.toolCallId,
      title,
      state: "input-available",
      input: resolvedInput,
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
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
  meta?: unknown;
}): ToolUIPart {
  const toolName = normalizeToolName(params.toolName ?? TOOL_FALLBACK_NAME);
  const title = params.title ?? params.toolName ?? TOOL_FALLBACK_NAME;
  const input = resolveToolInput(params.input, params.rawInput);
  const hasInput = params.input !== undefined || params.rawInput !== undefined;
  const callProviderMetadata = buildProviderMetadata({
    meta: params.meta,
  });
  const output = normalizeToolOutput(params.content, params.rawOutput);
  if (params.status === "failed") {
    return {
      type: toToolPartType(toolName),
      toolCallId: params.toolCallId,
      title,
      state: "output-error",
      input,
      errorText: stringifyError(params.rawOutput) ?? "Tool call failed",
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
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
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
    };
  }
  if (!hasInput) {
    return {
      type: toToolPartType(toolName),
      toolCallId: params.toolCallId,
      title,
      state: "input-streaming",
      input: undefined,
    };
  }
  return {
    type: toToolPartType(toolName),
    toolCallId: params.toolCallId,
    title,
    state: "input-available",
    input,
    ...(callProviderMetadata ? { callProviderMetadata } : {}),
  };
}

export function buildToolApprovalPart(params: {
  toolCallId: string;
  toolName: string;
  title?: string;
  input?: unknown;
  approvalId: string;
  meta?: unknown;
}): ToolUIPart {
  const callProviderMetadata = buildProviderMetadata({
    meta: params.meta,
  });
  return {
    type: toToolPartType(normalizeToolName(params.toolName)),
    toolCallId: params.toolCallId,
    title: params.title ?? params.toolName,
    state: "approval-requested",
    input: resolveToolInput(params.input),
    approval: { id: params.approvalId },
    ...(callProviderMetadata ? { callProviderMetadata } : {}),
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
  meta?: unknown;
}): ToolUIPart {
  const callProviderMetadata = buildProviderMetadata({
    meta: params.meta,
  });
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
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
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
    ...(callProviderMetadata ? { callProviderMetadata } : {}),
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

export function getToolNameFromCall(
  toolCall: acp.ToolCall | acp.ToolCallUpdate
): string {
  return toolCall.kind ?? toolCall.title ?? TOOL_FALLBACK_NAME;
}

export function buildProviderMetadataFromMeta(
  meta?: unknown
): ProviderMetadata | undefined {
  return buildProviderMetadata({ meta });
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
  const normalized = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || TOOL_FALLBACK_NAME;
}

function mergeProviderMetadata(
  existing?: ProviderMetadata,
  incoming?: ProviderMetadata
): ProviderMetadata | undefined {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const existingAcp =
    "acp" in existing && typeof existing.acp === "object" && existing.acp
      ? (existing.acp as Record<string, unknown>)
      : undefined;
  const incomingAcp =
    "acp" in incoming && typeof incoming.acp === "object" && incoming.acp
      ? (incoming.acp as Record<string, unknown>)
      : undefined;
  const mergedAcp =
    existingAcp || incomingAcp
      ? { ...(existingAcp ?? {}), ...(incomingAcp ?? {}) }
      : undefined;
  return mergedAcp
    ? { ...existing, ...incoming, acp: mergedAcp }
    : { ...existing, ...incoming };
}

function buildProviderMetadata(params: {
  meta?: unknown;
  annotations?: unknown;
  resourceMeta?: unknown;
}): ProviderMetadata | undefined {
  const acp: Record<string, unknown> = {};
  if (params.meta !== undefined) {
    acp._meta = params.meta;
  }
  if (params.annotations !== undefined) {
    acp.annotations = params.annotations;
  }
  if (params.resourceMeta !== undefined) {
    acp.resourceMeta = params.resourceMeta;
  }
  if (Object.keys(acp).length === 0) {
    return undefined;
  }
  return { acp };
}

function getBlockProviderMetadata(
  block: StoredContentBlock,
  resourceMeta?: unknown
): ProviderMetadata | undefined {
  return buildProviderMetadata({
    meta: getOptionalMeta(block),
    annotations: getOptionalAnnotations(block),
    resourceMeta,
  });
}

function getResourceMeta(resource: unknown): unknown | undefined {
  return getOptionalMeta(resource);
}

function getOptionalMeta(value: unknown): unknown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return "_meta" in value ? (value as { _meta?: unknown })._meta : undefined;
}

function getOptionalAnnotations(value: unknown): unknown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return "annotations" in value
    ? (value as { annotations?: unknown }).annotations
    : undefined;
}

function buildResourceDataPart(
  block: Extract<StoredContentBlock, { type: "resource" }>,
  resource: Extract<StoredContentBlock, { type: "resource" }>["resource"]
): DataUIPart | null {
  const hasText = "text" in resource && typeof resource.text === "string";
  const hasBlob = "blob" in resource && typeof resource.blob === "string";
  if (!(hasText || hasBlob)) {
    return null;
  }
  const data: Record<string, unknown> = {
    uri: resource.uri,
    mimeType: resource.mimeType,
  };
  if (hasText) {
    data.text = resource.text;
  }
  if (hasBlob) {
    data.blob = resource.blob;
  }
  const meta = getOptionalMeta(block);
  const annotations = getOptionalAnnotations(block);
  if (meta !== undefined) {
    data._meta = meta;
  }
  if (annotations !== undefined) {
    data.annotations = annotations;
  }
  const resourceMeta = getResourceMeta(resource);
  if (resourceMeta !== undefined) {
    data.resourceMeta = resourceMeta;
  }
  return { type: "data-resource", data };
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

function toDataUrl(
  mimeType?: string | null,
  data?: string | null
): string | null {
  if (!(mimeType && data)) {
    return null;
  }
  return `data:${mimeType};base64,${data}`;
}
