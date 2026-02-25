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

const ToolCallSchema = z
  .object({
    sessionUpdate: z.literal("tool_call"),
    toolCallId: z.string(),
    kind: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const ToolCallUpdateSchema = z
  .object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: z.string(),
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
  config_options_update: "config_option_update",
};

function normalizeSessionUpdateKind(kind: string): string {
  return SESSION_UPDATE_KIND_ALIASES[kind] ?? kind;
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
    return parsed.success ? (parsed.data as SessionUpdate) : null;
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
