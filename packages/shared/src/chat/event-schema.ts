import { z } from "zod";
import type { UIMessage } from "../ui-message";
import type { BroadcastEvent } from "./types";

const PROVIDER_METADATA_SCHEMA = z.record(z.string(), z.unknown());

const TEXT_PART_SCHEMA = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    state: z.enum(["streaming", "done"]).optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
  })
  .passthrough();

const REASONING_PART_SCHEMA = z
  .object({
    type: z.literal("reasoning"),
    text: z.string(),
    state: z.enum(["streaming", "done"]).optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
  })
  .passthrough();

const SOURCE_URL_PART_SCHEMA = z
  .object({
    type: z.literal("source-url"),
    sourceId: z.string(),
    url: z.string(),
    title: z.string().optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
  })
  .passthrough();

const SOURCE_DOCUMENT_PART_SCHEMA = z
  .object({
    type: z.literal("source-document"),
    sourceId: z.string(),
    mediaType: z.string(),
    title: z.string(),
    filename: z.string().optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
  })
  .passthrough();

const FILE_PART_SCHEMA = z
  .object({
    type: z.literal("file"),
    mediaType: z.string(),
    url: z.string(),
    filename: z.string().optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
  })
  .passthrough();

const STEP_START_PART_SCHEMA = z
  .object({
    type: z.literal("step-start"),
  })
  .passthrough();

const DATA_PART_SCHEMA = z
  .object({
    type: z.string().regex(/^data-/),
    id: z.string().optional(),
    data: z.unknown(),
  })
  .passthrough();

const TOOL_PART_SCHEMA = z
  .object({
    type: z.string().regex(/^tool-/),
    toolCallId: z.string(),
    state: z.enum([
      "input-streaming",
      "input-available",
      "approval-requested",
      "approval-responded",
      "output-available",
      "output-error",
      "output-denied",
    ]),
    title: z.string().optional(),
    providerExecuted: z.boolean().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    errorText: z.string().optional(),
    callProviderMetadata: PROVIDER_METADATA_SCHEMA.optional(),
    providerMetadata: PROVIDER_METADATA_SCHEMA.optional(),
    preliminary: z.boolean().optional(),
    approval: z
      .object({
        id: z.string(),
        approved: z.boolean().optional(),
        reason: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const UI_MESSAGE_PART_SCHEMA = z.union([
  TEXT_PART_SCHEMA,
  REASONING_PART_SCHEMA,
  SOURCE_URL_PART_SCHEMA,
  SOURCE_DOCUMENT_PART_SCHEMA,
  FILE_PART_SCHEMA,
  STEP_START_PART_SCHEMA,
  DATA_PART_SCHEMA,
  TOOL_PART_SCHEMA,
]);

export const UI_MESSAGE_SCHEMA = z
  .object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    metadata: z.unknown().optional(),
    parts: z.array(UI_MESSAGE_PART_SCHEMA),
  })
  .passthrough();

const SESSION_INFO_SCHEMA = z
  .object({
    title: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

const SESSION_CONFIG_SELECT_OPTION_SCHEMA = z
  .object({
    value: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const SESSION_CONFIG_SELECT_GROUP_SCHEMA = z
  .object({
    group: z.string(),
    name: z.string(),
    options: z.array(SESSION_CONFIG_SELECT_OPTION_SCHEMA),
  })
  .passthrough();

const SESSION_CONFIG_OPTION_SCHEMA = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    type: z.literal("select"),
    currentValue: z.string(),
    options: z.union([
      z.array(SESSION_CONFIG_SELECT_OPTION_SCHEMA),
      z.array(SESSION_CONFIG_SELECT_GROUP_SCHEMA),
    ]),
  })
  .passthrough();

const CHAT_STATUS_SCHEMA = z.enum([
  "inactive",
  "connecting",
  "ready",
  "submitted",
  "streaming",
  "awaiting_permission",
  "cancelling",
  "error",
]);

const AVAILABLE_COMMAND_SCHEMA = z
  .object({
    name: z.string(),
    description: z.string(),
    input: z
      .object({
        hint: z.string(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export const BROADCAST_EVENT_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }).passthrough(),
  z
    .object({
      type: z.literal("chat_status"),
      status: CHAT_STATUS_SCHEMA,
      turnId: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("chat_finish"),
      stopReason: z.string(),
      finishReason: z.string(),
      messageId: z.string().optional(),
      message: UI_MESSAGE_SCHEMA.optional(),
      isAbort: z.boolean(),
      turnId: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("ui_message"),
      message: UI_MESSAGE_SCHEMA,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("ui_message_delta"),
      messageId: z.string(),
      partIndex: z.number().int().nonnegative(),
      delta: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("file_modified"),
      path: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("available_commands_update"),
      availableCommands: z.array(AVAILABLE_COMMAND_SCHEMA),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("config_options_update"),
      configOptions: z.array(SESSION_CONFIG_OPTION_SCHEMA),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("session_info_update"),
      sessionInfo: SESSION_INFO_SCHEMA,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("current_mode_update"),
      modeId: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("terminal_output"),
      terminalId: z.string(),
      data: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("heartbeat"),
      ts: z.number(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("error"),
      error: z.string(),
    })
    .passthrough(),
]);

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function toParseErrorMessage(prefix: string, error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return `${prefix}: ${issues}`;
}

export function parseUiMessageStrict(raw: unknown): ParseResult<UIMessage> {
  const parsed = UI_MESSAGE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toParseErrorMessage("Invalid UI message payload", parsed.error),
    };
  }
  return { ok: true, value: parsed.data as UIMessage };
}

export function parseUiMessageArrayStrict(
  raw: unknown
): ParseResult<UIMessage[]> {
  const parsed = z.array(UI_MESSAGE_SCHEMA).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toParseErrorMessage("Invalid UI message array payload", parsed.error),
    };
  }
  return { ok: true, value: parsed.data as UIMessage[] };
}

export function parseBroadcastEventStrict(
  raw: unknown
): ParseResult<BroadcastEvent> {
  const parsed = BROADCAST_EVENT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: toParseErrorMessage("Invalid chat broadcast event", parsed.error),
    };
  }
  return { ok: true, value: parsed.data as BroadcastEvent };
}
