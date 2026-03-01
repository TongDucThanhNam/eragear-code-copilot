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
    createdAt: z.number().finite().optional(),
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
      type: z.literal("ui_message_part"),
      messageId: z.string(),
      messageRole: z.enum(["system", "user", "assistant"]),
      partIndex: z.number().int().nonnegative(),
      part: UI_MESSAGE_PART_SCHEMA,
      isNew: z.boolean(),
      createdAt: z.number().finite().optional(),
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
      type: z.literal("current_model_update"),
      modelId: z.string(),
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

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ClientParseIssueKind = "unknown_event" | "invalid_payload";

export type ClientParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: ClientParseIssueKind; error: string };

const BROADCAST_EVENT_TYPES = [
  "connected",
  "chat_status",
  "chat_finish",
  "ui_message",
  "ui_message_part",
  "ui_message_delta",
  "file_modified",
  "available_commands_update",
  "config_options_update",
  "session_info_update",
  "current_mode_update",
  "current_model_update",
  "terminal_output",
  "heartbeat",
  "error",
] as const;
const BROADCAST_EVENT_TYPE_SET = new Set<string>(BROADCAST_EVENT_TYPES);

const UI_MESSAGE_ENVELOPE_SCHEMA = z
  .object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    createdAt: z.number().finite().optional(),
    metadata: z.unknown().optional(),
    parts: z.array(z.unknown()),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
      error: toParseErrorMessage(
        "Invalid UI message array payload",
        parsed.error
      ),
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

function sanitizeUiMessageParts(parts: unknown[]): UIMessage["parts"] {
  const sanitizedParts: UIMessage["parts"] = [];
  for (const rawPart of parts) {
    const parsedPart = UI_MESSAGE_PART_SCHEMA.safeParse(rawPart);
    if (!parsedPart.success) {
      continue;
    }
    sanitizedParts.push(parsedPart.data as UIMessage["parts"][number]);
  }
  return sanitizedParts;
}

export function parseUiMessageClientSafe(
  raw: unknown
): ClientParseResult<UIMessage> {
  const parsed = UI_MESSAGE_ENVELOPE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "invalid_payload",
      error: toParseErrorMessage("Invalid UI message payload", parsed.error),
    };
  }

  const sanitizedMessage: UIMessage = {
    id: parsed.data.id,
    role: parsed.data.role,
    parts: sanitizeUiMessageParts(parsed.data.parts),
  };

  if (typeof parsed.data.createdAt === "number") {
    sanitizedMessage.createdAt = parsed.data.createdAt;
  }

  if (Object.hasOwn(parsed.data, "metadata")) {
    sanitizedMessage.metadata = parsed.data.metadata;
  }

  return { ok: true, value: sanitizedMessage };
}

export function parseUiMessageArrayClientSafe(
  raw: unknown
): ClientParseResult<UIMessage[]> {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      kind: "invalid_payload",
      error: "Invalid UI message array payload: root: Expected array",
    };
  }

  const sanitizedMessages: UIMessage[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const parsedMessage = parseUiMessageClientSafe(raw[index]);
    if (!parsedMessage.ok) {
      return {
        ok: false,
        kind: "invalid_payload",
        error: `Invalid UI message array payload: index ${index}: ${parsedMessage.error}`,
      };
    }
    sanitizedMessages.push(parsedMessage.value);
  }

  return { ok: true, value: sanitizedMessages };
}

function getRawEventType(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null;
  }
  return typeof raw.type === "string" ? raw.type : null;
}

export function parseBroadcastEventClientSafe(
  raw: unknown
): ClientParseResult<BroadcastEvent> {
  const eventType = getRawEventType(raw);
  if (!eventType) {
    return {
      ok: false,
      kind: "invalid_payload",
      error: "Invalid chat broadcast event: root: Missing string type field",
    };
  }

  if (!BROADCAST_EVENT_TYPE_SET.has(eventType)) {
    return {
      ok: false,
      kind: "unknown_event",
      error: `Unknown chat broadcast event type: ${eventType}`,
    };
  }

  let normalizedRaw = raw;
  if (eventType === "ui_message") {
    const uiMessage = parseUiMessageClientSafe(
      isRecord(raw) ? raw.message : undefined
    );
    if (!uiMessage.ok) {
      return {
        ok: false,
        kind: "invalid_payload",
        error: `Invalid chat broadcast event: ${uiMessage.error}`,
      };
    }
    normalizedRaw = {
      ...(raw as Record<string, unknown>),
      message: uiMessage.value,
    };
  } else if (eventType === "ui_message_part") {
    if (!isRecord(raw)) {
      return {
        ok: false,
        kind: "invalid_payload",
        error: "Invalid chat broadcast event: root: Expected object payload",
      };
    }
    const parsedPart = UI_MESSAGE_PART_SCHEMA.safeParse(raw.part);
    if (!parsedPart.success) {
      return {
        ok: false,
        kind: "invalid_payload",
        error: toParseErrorMessage(
          "Invalid UI message part payload",
          parsedPart.error
        ),
      };
    }
    normalizedRaw = {
      ...raw,
      part: parsedPart.data,
    };
  } else if (
    eventType === "chat_finish" &&
    isRecord(raw) &&
    raw.message !== undefined
  ) {
    const uiMessage = parseUiMessageClientSafe(raw.message);
    if (!uiMessage.ok) {
      return {
        ok: false,
        kind: "invalid_payload",
        error: `Invalid chat broadcast event: ${uiMessage.error}`,
      };
    }
    normalizedRaw = {
      ...raw,
      message: uiMessage.value,
    };
  }

  const parsed = BROADCAST_EVENT_SCHEMA.safeParse(normalizedRaw);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "invalid_payload",
      error: toParseErrorMessage("Invalid chat broadcast event", parsed.error),
    };
  }

  return { ok: true, value: parsed.data as BroadcastEvent };
}
