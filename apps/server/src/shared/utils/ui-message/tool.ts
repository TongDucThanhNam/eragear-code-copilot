import type * as acp from "@agentclientprotocol/sdk";
import type { ToolUIPart } from "@repo/shared";
import type { Plan } from "@/shared/types/session.types";
import { toStoredToolCallContent } from "@/shared/utils/content-block.util";
import { escapeHtmlText, sanitizeStringValues } from "@/shared/utils/html.util";
import { buildProviderMetadata } from "./metadata";

const TOOL_FALLBACK_NAME = "tool";
const PLAN_TOOL_CALL_ID = "plan";
const ERROR_TEXT_MAX_LENGTH = 4000;
const ERROR_DATA_MAX_LENGTH = 1200;

export function getPlanToolCallId(chatId: string) {
  return `${PLAN_TOOL_CALL_ID}:${chatId}`;
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

function getOptionalMeta(value: unknown): unknown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return "_meta" in value ? (value as { _meta?: unknown })._meta : undefined;
}

function normalizeToolName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const normalized = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    return sanitizeStringValues(sanitized);
  }
  return sanitizeStringValues(rawOutput);
}

function stringifyError(rawOutput?: unknown) {
  const formatted =
    formatStructuredErrorBlock(rawOutput) ?? formatErrorSummary(rawOutput, 0);
  if (!formatted) {
    return null;
  }
  return escapeHtmlText(truncateText(formatted, ERROR_TEXT_MAX_LENGTH));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatStructuredErrorBlock(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const directError = value.error;
  if (typeof directError === "string") {
    const trimmed = directError.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const requestPayload = getRpcRequestPayload(value);
  const errorPayload = getRpcErrorPayload(value);
  if (requestPayload && errorPayload) {
    const requestJson = toPrettyJson(requestPayload);
    const errorJson = toPrettyJson(errorPayload);
    if (requestJson && errorJson) {
      return `Error handling request ${requestJson} ${errorJson}`;
    }
  }

  if (isRpcErrorLike(value)) {
    return toPrettyJson(value);
  }

  if (isRecord(directError) && isRpcErrorLike(directError)) {
    return toPrettyJson(directError);
  }

  return null;
}

function getRpcRequestPayload(
  value: Record<string, unknown>
): Record<string, unknown> | null {
  const method =
    typeof value.method === "string" && value.method.trim().length > 0
      ? value.method.trim()
      : null;
  if (!method) {
    return null;
  }

  const request: Record<string, unknown> = { method };
  if (typeof value.jsonrpc === "string") {
    request.jsonrpc = value.jsonrpc;
  }
  if (value.id !== undefined) {
    request.id = value.id;
  }
  if (value.params !== undefined) {
    request.params = value.params;
  }
  return request;
}

function getRpcErrorPayload(value: Record<string, unknown>): unknown {
  if (value.error !== undefined) {
    return value.error;
  }
  if (value.err !== undefined) {
    return value.err;
  }
  if (value.cause !== undefined) {
    return value.cause;
  }
  if (value.response !== undefined) {
    return value.response;
  }
  return null;
}

function isRpcErrorLike(value: Record<string, unknown>): boolean {
  return (
    typeof value.message === "string" ||
    typeof value.errorMessage === "string" ||
    typeof value.code === "string" ||
    typeof value.code === "number" ||
    value.data !== undefined
  );
}

function toPrettyJson(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(sanitizeStringValues(value), null, 2);
    if (!serialized) {
      return null;
    }
    return truncateText(serialized, ERROR_TEXT_MAX_LENGTH);
  } catch {
    return null;
  }
}

function formatErrorSummary(value: unknown, depth: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Error) {
    const trimmed = value.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (depth > 3) {
    return fallbackSerialize(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = formatErrorSummary(item, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return fallbackSerialize(value);
  }
  if (!isRecord(value)) {
    return null;
  }

  const nestedKeys = ["error", "err", "cause", "response"];
  for (const key of nestedKeys) {
    if (!(key in value)) {
      continue;
    }
    const nested = formatErrorSummary(value[key], depth + 1);
    if (!nested) {
      continue;
    }
    const context = formatRequestContext(value);
    return context ? `${context} | ${nested}` : nested;
  }

  const rpcError = formatRpcError(value);
  if (rpcError) {
    return rpcError;
  }

  const details = extractFirstString(value, [
    "details",
    "detail",
    "reason",
    "errorMessage",
  ]);
  if (details) {
    return details;
  }

  return fallbackSerialize(value);
}

function formatRequestContext(record: Record<string, unknown>): string | null {
  const method =
    typeof record.method === "string" && record.method.trim().length > 0
      ? record.method.trim()
      : null;
  if (!method) {
    return null;
  }
  const params = record.params;
  if (!isRecord(params)) {
    return method;
  }
  const path =
    typeof params.path === "string" && params.path.trim().length > 0
      ? params.path.trim()
      : null;
  return path ? `${method} (${path})` : method;
}

function formatRpcError(record: Record<string, unknown>): string | null {
  const message = extractFirstString(record, ["message", "errorMessage"]);
  const code =
    typeof record.code === "string" || typeof record.code === "number"
      ? String(record.code)
      : null;
  const data = formatRpcErrorData(record.data);
  if (!message && !code && !data) {
    return null;
  }

  const parts: string[] = [];
  if (message) {
    parts.push(message);
  }
  if (code) {
    parts.push(`code=${code}`);
  }
  if (data) {
    parts.push(`data=${data}`);
  }
  return parts.join(" | ");
}

function formatRpcErrorData(data: unknown): string | null {
  if (data === undefined || data === null) {
    return null;
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? truncateText(trimmed, ERROR_DATA_MAX_LENGTH) : null;
  }
  if (typeof data === "number" || typeof data === "boolean") {
    return String(data);
  }
  if (!isRecord(data) && !Array.isArray(data)) {
    return null;
  }

  const sanitized = sanitizeStringValues(data);
  if (isRecord(sanitized)) {
    const path =
      typeof sanitized.path === "string" && sanitized.path.trim().length > 0
        ? sanitized.path.trim()
        : null;
    const details =
      typeof sanitized.details === "string" && sanitized.details.trim().length > 0
        ? sanitized.details.trim()
        : null;
    if (path && details) {
      return truncateText(`path=${path}; details=${details}`, ERROR_DATA_MAX_LENGTH);
    }
    if (path) {
      return truncateText(`path=${path}`, ERROR_DATA_MAX_LENGTH);
    }
    if (details) {
      return truncateText(details, ERROR_DATA_MAX_LENGTH);
    }
  }

  try {
    return truncateText(
      JSON.stringify(sanitized),
      ERROR_DATA_MAX_LENGTH
    );
  } catch {
    return null;
  }
}

function extractFirstString(
  value: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function fallbackSerialize(value: unknown): string | null {
  return toPrettyJson(value);
}
