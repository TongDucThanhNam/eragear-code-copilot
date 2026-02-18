import type * as acp from "@agentclientprotocol/sdk";
import type { ToolUIPart } from "@repo/shared";
import type { Plan } from "@/shared/types/session.types";
import { toStoredToolCallContent } from "@/shared/utils/content-block.util";
import { buildProviderMetadata } from "./metadata";

const TOOL_FALLBACK_NAME = "tool";
const PLAN_TOOL_CALL_ID = "plan";

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
