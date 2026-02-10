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
    kind: z.string(),
    status: z.string().optional(),
  })
  .passthrough();

const ToolCallUpdateSchema = z
  .object({
    sessionUpdate: z.literal("tool_call_update"),
    toolCallId: z.string(),
    status: z.string(),
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
    currentModeId: z.string(),
  })
  .passthrough();

const ConfigOptionUpdateSchema = z
  .object({
    sessionUpdate: z.literal("config_option_update"),
    configOptions: z.array(z.unknown()),
  })
  .passthrough();

const SessionInfoUpdateSchema = z
  .object({
    sessionUpdate: z.literal("session_info_update"),
  })
  .passthrough();

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
    return parsed.success ? (parsed.data as SessionUpdate) : null;
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

  const validatedKnown = validateKnownSessionUpdate(
    raw,
    discriminator.data.sessionUpdate
  );
  if (validatedKnown) {
    return validatedKnown;
  }
  if (isKnownSessionUpdateKind(discriminator.data.sessionUpdate)) {
    return null;
  }

  return discriminator.data as SessionUpdate;
}
