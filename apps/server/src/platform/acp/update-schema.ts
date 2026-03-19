import { z } from "zod";
import { safeJsonStringify } from "@/shared/utils/json.util";
import { serializeRawPayloadForLog } from "./raw-payload-log.util";
import type { SessionUpdate } from "./update-types";

const SESSION_UPDATE_KIND_MAX_LENGTH = 128;
const SESSION_UPDATE_TYPE_MAX_LENGTH = 64;
const SESSION_UPDATE_MODE_ID_MAX_LENGTH = 128;
const SESSION_UPDATE_REASON_MAX_LENGTH = 512;
const SESSION_UPDATE_NAME_MAX_LENGTH = 256;
const SESSION_UPDATE_DESCRIPTION_MAX_LENGTH = 4096;
const SESSION_UPDATE_TEXT_MAX_LENGTH = 16_384;
const SESSION_UPDATE_VALUE_MAX_LENGTH = 512;
const SESSION_UPDATE_CATEGORY_MAX_LENGTH = 128;
const SESSION_UPDATE_TITLE_MAX_LENGTH = 512;
const SESSION_UPDATE_TIMESTAMP_MAX_LENGTH = 128;
const PLAN_ENTRY_MAX_COUNT = 256;
const AVAILABLE_COMMANDS_MAX_COUNT = 256;
const CONFIG_OPTIONS_MAX_COUNT = 128;
const CONFIG_OPTION_VALUES_MAX_COUNT = 256;

const SessionUpdateKindSchema = z
  .string()
  .trim()
  .min(1)
  .max(SESSION_UPDATE_KIND_MAX_LENGTH);

const SessionUpdateTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(SESSION_UPDATE_TYPE_MAX_LENGTH);

const ModeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SESSION_UPDATE_MODE_ID_MAX_LENGTH);

const BoundedNameSchema = z.string().max(SESSION_UPDATE_NAME_MAX_LENGTH);

const BoundedDescriptionSchema = z
  .string()
  .trim()
  .max(SESSION_UPDATE_DESCRIPTION_MAX_LENGTH);

const BoundedTextSchema = z.string().max(SESSION_UPDATE_TEXT_MAX_LENGTH);

const BoundedValueSchema = z.string().max(SESSION_UPDATE_VALUE_MAX_LENGTH);

const SessionUpdateDiscriminatorSchema = z
  .object({
    sessionUpdate: SessionUpdateKindSchema,
  })
  .passthrough();

const ContentSchema = z
  .object({
    type: SessionUpdateTypeSchema,
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
// biome-ignore lint/suspicious/noControlCharactersInRegex: Control characters in regex are intentional for tool call ID validation
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
    kind: BoundedNameSchema.optional(),
    status: BoundedNameSchema.optional(),
  })
  .passthrough();

const ToolCallUpdateSchema = z
  .object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: ToolCallIdSchema,
    status: BoundedNameSchema.optional(),
  })
  .passthrough();

const PlanSchema = z
  .object({
    sessionUpdate: z.literal("plan"),
    entries: z
      .array(
        z
          .object({
            content: BoundedTextSchema,
            priority: z.enum(["high", "medium", "low"]),
            status: z.enum(["pending", "in_progress", "completed"]),
          })
          .passthrough()
      )
      .max(PLAN_ENTRY_MAX_COUNT),
  })
  .passthrough();

const AvailableCommandsUpdateSchema = z
  .object({
    sessionUpdate: z.literal("available_commands_update"),
    availableCommands: z
      .array(
        z
          .object({
            name: BoundedNameSchema,
            description: BoundedDescriptionSchema,
          })
          .passthrough()
      )
      .max(AVAILABLE_COMMANDS_MAX_COUNT),
  })
  .passthrough();

const CurrentModeUpdateSchema = z
  .object({
    sessionUpdate: z.literal("current_mode_update"),
    currentModeId: ModeIdSchema.optional(),
    modeId: ModeIdSchema.optional(),
    reason: z.string().trim().max(SESSION_UPDATE_REASON_MAX_LENGTH).optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();

const ConfigOptionValueSchema = z
  .object({
    value: BoundedValueSchema,
    name: BoundedNameSchema,
    description: BoundedDescriptionSchema.nullable().optional(),
  })
  .passthrough();

const ConfigOptionGroupSchema = z
  .object({
    group: z.string().trim().min(1).max(SESSION_UPDATE_CATEGORY_MAX_LENGTH),
    name: BoundedNameSchema,
    options: z
      .array(ConfigOptionValueSchema)
      .max(CONFIG_OPTION_VALUES_MAX_COUNT),
  })
  .passthrough();

const SessionConfigOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(SESSION_UPDATE_CATEGORY_MAX_LENGTH),
    name: BoundedNameSchema,
    type: z.literal("select"),
    currentValue: BoundedValueSchema,
    options: z.union([
      z.array(ConfigOptionValueSchema).max(CONFIG_OPTION_VALUES_MAX_COUNT),
      z.array(ConfigOptionGroupSchema),
    ]),
    category: z
      .string()
      .trim()
      .max(SESSION_UPDATE_CATEGORY_MAX_LENGTH)
      .nullable()
      .optional(),
    description: BoundedDescriptionSchema.nullable().optional(),
  })
  .passthrough();

const ConfigOptionUpdateSchema = z
  .object({
    sessionUpdate: z.literal("config_option_update"),
    configOptions: z
      .array(SessionConfigOptionSchema)
      .max(CONFIG_OPTIONS_MAX_COUNT),
  })
  .passthrough();

const SessionInfoUpdateSchema = z
  .object({
    sessionUpdate: z.literal("session_info_update"),
    title: z
      .string()
      .trim()
      .max(SESSION_UPDATE_TITLE_MAX_LENGTH)
      .nullable()
      .optional(),
    updatedAt: z
      .string()
      .trim()
      .max(SESSION_UPDATE_TIMESTAMP_MAX_LENGTH)
      .nullable()
      .optional(),
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
    (normalized.endsWith("_message_chunk") ||
      normalized.endsWith("_text_chunk"))
  ) {
    return "agent_message_chunk";
  }

  if (
    normalized.includes("user") &&
    (normalized.endsWith("_message_chunk") ||
      normalized.endsWith("_text_chunk"))
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
      return candidate.length <= SESSION_UPDATE_TEXT_MAX_LENGTH
        ? candidate
        : null;
    }
  }
  return null;
}

/**
 * Normalize provider chunk payload wrappers into canonical text content blocks
 * accepted by server UIMessage mapping.
 */
function normalizeChunkContent(
  content: unknown
): Record<string, unknown> | null {
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
      return candidate.content.length <= SESSION_UPDATE_TEXT_MAX_LENGTH
        ? { type: "text", text: candidate.content }
        : null;
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
      type: "text",
      text,
    };
  }

  if (!rawType) {
    return null;
  }

  return candidate;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validation branching across multiple session update kinds
function validateKnownSessionUpdate(
  raw: unknown,
  kind: string
): {
  update: SessionUpdate | null;
  failureReason?: string;
  failureIssues?: string[];
} {
  if (
    kind === "user_message_chunk" ||
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    const parsed = ChunkUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return buildSchemaValidationFailure(parsed.error);
    }
    const normalizedContent = normalizeChunkContent(parsed.data.content);
    if (!normalizedContent) {
      return {
        update: null,
        failureReason:
          "chunk content normalization failed or exceeded size limits",
      };
    }
    return {
      update: {
        ...parsed.data,
        content: normalizedContent,
      } as SessionUpdate,
    };
  }
  if (kind === "tool_call") {
    const parsed = ToolCallSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  if (kind === "tool_call_update") {
    const parsed = ToolCallUpdateSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  if (kind === "plan") {
    const parsed = PlanSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  if (kind === "available_commands_update") {
    const parsed = AvailableCommandsUpdateSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  if (kind === "current_mode_update") {
    const parsed = CurrentModeUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return buildSchemaValidationFailure(parsed.error);
    }
    const currentModeId = parsed.data.currentModeId ?? parsed.data.modeId;
    if (!currentModeId) {
      return {
        update: null,
        failureReason: "current_mode_update requires currentModeId or modeId",
      };
    }
    return {
      update: {
        ...parsed.data,
        currentModeId,
      } as SessionUpdate,
    };
  }
  if (kind === "config_option_update") {
    const parsed = ConfigOptionUpdateSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  if (kind === "session_info_update") {
    const parsed = SessionInfoUpdateSchema.safeParse(raw);
    return parsed.success
      ? { update: parsed.data as SessionUpdate }
      : buildSchemaValidationFailure(parsed.error);
  }
  return { update: null };
}

function buildSchemaValidationFailure(error: z.ZodError<unknown>) {
  return {
    update: null,
    failureReason: "schema validation failed",
    failureIssues: error.issues.map((issue) => formatZodIssue(issue)),
  };
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  return `${path}: ${issue.message}`;
}

function logKnownSessionUpdateValidationFailure(params: {
  kind: string;
  raw: unknown;
  reason?: string;
  issues?: string[];
}) {
  const context = safeJsonStringify({
    updateKind: params.kind,
    reason: params.reason ?? "unknown validation failure",
    issues: params.issues?.slice(0, 8),
    rawPayload: serializeRawPayloadForLog(params.raw),
  });
  // biome-ignore lint/suspicious/noConsole: Logging validation failures for debugging
  console.warn(`ACP known session update validation failed ${context}`);
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

  const validatedKnown = validateKnownSessionUpdate(
    normalizedRaw,
    normalizedKind
  );
  if (validatedKnown.update) {
    return validatedKnown.update;
  }
  if (isKnownSessionUpdateKind(normalizedKind)) {
    logKnownSessionUpdateValidationFailure({
      kind: normalizedKind,
      raw: normalizedRaw,
      reason: validatedKnown.failureReason,
      issues: validatedKnown.failureIssues,
    });
    return null;
  }

  return normalizedRaw as SessionUpdate;
}
