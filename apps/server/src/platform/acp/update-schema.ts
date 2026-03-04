import { z } from "zod";
import type { SessionUpdate } from "./update-types";

const SessionUpdateDiscriminatorSchema = z
  .object({
    sessionUpdate: z.string(),
  })
  .passthrough();

const ContentSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const ChunkUpdateSchema = z
  .object({
    sessionUpdate: z.enum([
      "user_message_chunk",
      "agent_message_chunk",
      "agent_thought_chunk",
    ]),
    content: ContentSchema,
  })
  .passthrough();

const TOOL_CALL_ID_MAX_LENGTH = 256;
const TOOL_CALL_ID_PATTERN = /^[^\s\u0000-\u001F\u007F]+$/;
const ToolCallIdSchema = z
  .string()
  .min(1)
  .max(TOOL_CALL_ID_MAX_LENGTH)
  .refine((value) => TOOL_CALL_ID_PATTERN.test(value), {
    message: "Invalid toolCallId format",
  });

const ToolCallSchema = z
  .object({
    sessionUpdate: z.literal("tool_call"),
    toolCallId: ToolCallIdSchema,
    kind: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const ToolCallUpdateSchema = z
  .object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: ToolCallIdSchema,
    status: z.string().optional(),
  })
  .passthrough();

const PlanSchema = z
  .object({
    sessionUpdate: z.literal("plan"),
    entries: z.array(
      z
        .object({
          content: z.string(),
          priority: z.enum(["high", "medium", "low"]),
          status: z.enum(["pending", "in_progress", "completed"]),
        })
        .passthrough()
    ),
  })
  .passthrough();

const AvailableCommandsUpdateSchema = z
  .object({
    sessionUpdate: z.literal("available_commands_update"),
    availableCommands: z.array(
      z
        .object({
          name: z.string(),
          description: z.string(),
        })
        .passthrough()
    ),
  })
  .passthrough();

const CurrentModeUpdateSchema = z
  .object({
    sessionUpdate: z.literal("current_mode_update"),
    currentModeId: z.string().optional(),
    modeId: z.string().optional(),
  })
  .passthrough();

const ConfigOptionValueSchema = z
  .object({
    value: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const ConfigOptionGroupSchema = z
  .object({
    group: z.string(),
    name: z.string(),
    options: z.array(ConfigOptionValueSchema),
  })
  .passthrough();

const SessionConfigOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.literal("select"),
    currentValue: z.string(),
    options: z.union([
      z.array(ConfigOptionValueSchema),
      z.array(ConfigOptionGroupSchema),
    ]),
    category: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const ConfigOptionUpdateSchema = z
  .object({
    sessionUpdate: z.literal("config_option_update"),
    configOptions: z.array(SessionConfigOptionSchema),
  })
  .passthrough();

const SessionInfoUpdateSchema = z
  .object({
    sessionUpdate: z.literal("session_info_update"),
    title: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

const SESSION_UPDATE_KIND_ALIASES: Record<string, string> = {
  assistant_message_chunk: "agent_message_chunk",
  assistant_thought_chunk: "agent_thought_chunk",
  assistant_reasoning_chunk: "agent_thought_chunk",
  config_options_update: "config_option_update",
};

/**
 * Normalize known ACP chunk kind aliases and provider-specific variants into
 * canonical server chunk kinds.
 */
function normalizeSessionUpdateKind(kind: string): string {
  const aliased = SESSION_UPDATE_KIND_ALIASES[kind];
  if (aliased) {
    return aliased;
  }

  const normalized = kind.trim().toLowerCase();
  if (normalized.length === 0) {
    return kind;
  }

  if (
    (normalized.includes("assistant") || normalized.includes("agent")) &&
    (normalized.endsWith("_thought_chunk") ||
      normalized.endsWith("_reasoning_chunk"))
  ) {
    return "agent_thought_chunk";
  }

  if (
    (normalized.includes("assistant") || normalized.includes("agent")) &&
    (normalized.endsWith("_message_chunk") || normalized.endsWith("_text_chunk"))
  ) {
    return "agent_message_chunk";
  }

  if (
    normalized.includes("user") &&
    (normalized.endsWith("_message_chunk") || normalized.endsWith("_text_chunk"))
  ) {
    return "user_message_chunk";
  }

  return kind;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readChunkText(value: Record<string, unknown>): string | null {
  const candidates = [
    value.text,
    value.delta,
    value.reasoning,
    value.token,
    value.value,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return null;
}

/**
 * Normalize provider chunk payload wrappers into canonical text content blocks
 * accepted by server UIMessage mapping.
 */
function normalizeChunkContent(content: unknown): Record<string, unknown> | null {
  const candidate = asRecord(content);
  if (!candidate) {
    return null;
  }

  const nestedContent = asRecord(candidate.content);
  const rawType = typeof candidate.type === "string" ? candidate.type : "";
  const type = rawType.toLowerCase();

  if (type === "content") {
    if (nestedContent) {
      return normalizeChunkContent(nestedContent);
    }
    if (typeof candidate.content === "string") {
      return { type: "text", text: candidate.content };
    }
    return null;
  }

  if (!rawType && nestedContent) {
    return normalizeChunkContent(nestedContent);
  }

  if (
    type === "text_delta" ||
    type === "delta" ||
    type === "token" ||
    type === "reasoning" ||
    type === "thinking"
  ) {
    const text = readChunkText(candidate);
    if (text === null) {
      return null;
    }
    return {
      ...candidate,
      type: "text",
      text,
    };
  }

  if (type === "text") {
    const text = readChunkText(candidate);
    if (text === null) {
      return null;
    }
    return {
      ...candidate,
      type: "text",
      text,
    };
  }

  if (!rawType) {
    return null;
  }

  return candidate;
}

function validateKnownSessionUpdate(
  raw: unknown,
  kind: string
): SessionUpdate | null {
  if (
    kind === "user_message_chunk" ||
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    const parsed = ChunkUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const normalizedContent = normalizeChunkContent(parsed.data.content);
    if (!normalizedContent) {
      return null;
    }
    return {
      ...parsed.data,
      content: normalizedContent,
    } as SessionUpdate;
  }
  if (kind === "tool_call") {
    const parsed = ToolCallSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  if (kind === "tool_call_update") {
    const parsed = ToolCallUpdateSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  if (kind === "plan") {
    const parsed = PlanSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  if (kind === "available_commands_update") {
    const parsed = AvailableCommandsUpdateSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  if (kind === "current_mode_update") {
    const parsed = CurrentModeUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const currentModeId = parsed.data.currentModeId ?? parsed.data.modeId;
    if (!currentModeId) {
      return null;
    }
    return {
      ...parsed.data,
      currentModeId,
    } as SessionUpdate;
  }
  if (kind === "config_option_update") {
    const parsed = ConfigOptionUpdateSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  if (kind === "session_info_update") {
    const parsed = SessionInfoUpdateSchema.safeParse(raw);
    return parsed.success ? (parsed.data as SessionUpdate) : null;
  }
  return null;
}

function isKnownSessionUpdateKind(kind: string): boolean {
  return (
    kind === "user_message_chunk" ||
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk" ||
    kind === "tool_call" ||
    kind === "tool_call_update" ||
    kind === "plan" ||
    kind === "available_commands_update" ||
    kind === "current_mode_update" ||
    kind === "config_option_update" ||
    kind === "session_info_update"
  );
}

export function parseSessionUpdatePayload(raw: unknown): SessionUpdate | null {
  const discriminator = SessionUpdateDiscriminatorSchema.safeParse(raw);
  if (!discriminator.success) {
    return null;
  }
  const normalizedKind = normalizeSessionUpdateKind(
    discriminator.data.sessionUpdate
  );
  const normalizedRaw: unknown =
    normalizedKind === discriminator.data.sessionUpdate
      ? raw
      : {
          ...discriminator.data,
          sessionUpdate: normalizedKind,
        };

  const validatedKnown = validateKnownSessionUpdate(normalizedRaw, normalizedKind);
  if (validatedKnown) {
    return validatedKnown;
  }
  if (isKnownSessionUpdateKind(normalizedKind)) {
    return null;
  }

  return normalizedRaw as SessionUpdate;
}
