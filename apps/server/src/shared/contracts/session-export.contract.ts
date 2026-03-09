import { z } from "zod";
import type { StoredMessage, StoredSession } from "@/shared/types/session.types";
import {
  createRedactedValue,
  type RedactedValue,
} from "@/shared/utils/redaction.util";

export const SESSION_EXPORT_SCHEMA_VERSION = "session-export/v1" as const;
export const SESSION_EXPORT_REDACTION_POLICY_VERSION =
  "session-export-redaction/v1" as const;

export const SessionExportRedactedValueSchema = z.object({
  kind: z.literal("redacted"),
  reason: z.enum([
    "credential",
    "message_content",
    "structured_payload",
    "filesystem_path",
    "runtime_metadata",
  ]),
  summary: z.string().min(1),
});

export const SessionExportRedactionSchema = z.object({
  path: z.string().min(1),
  value: SessionExportRedactedValueSchema,
});

export const SessionExportMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  timestamp: z.number(),
  isCompacted: z.boolean().optional(),
  content: SessionExportRedactedValueSchema,
  contentBlocks: z.array(SessionExportRedactedValueSchema).optional(),
  reasoning: SessionExportRedactedValueSchema.optional(),
  reasoningBlocks: z.array(SessionExportRedactedValueSchema).optional(),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        args: SessionExportRedactedValueSchema,
      })
    )
    .optional(),
  parts: z.array(SessionExportRedactedValueSchema).optional(),
});

export const SessionExportPlanSchema = z
  .object({
    entries: z.array(
      z.object({
        priority: z.enum(["high", "medium", "low"]),
        status: z.enum(["pending", "in_progress", "completed"]),
        content: SessionExportRedactedValueSchema,
      })
    ),
  })
  .optional();

export const SessionExportSchema = z.object({
  schemaVersion: z.literal(SESSION_EXPORT_SCHEMA_VERSION),
  redactionPolicyVersion: z.literal(SESSION_EXPORT_REDACTION_POLICY_VERSION),
  exportedAt: z.string().datetime(),
  redactions: z.array(SessionExportRedactionSchema),
  session: z.object({
    id: z.string(),
    name: z.string().optional(),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    projectId: z.string().optional(),
    status: z.enum(["running", "stopped"]),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    createdAt: z.number(),
    lastActiveAt: z.number(),
    modeId: z.string().optional(),
    modelId: z.string().optional(),
    messageCount: z.number().int().nonnegative(),
    messages: z.array(SessionExportMessageSchema),
    plan: SessionExportPlanSchema,
  }),
});

export type SessionExport = z.infer<typeof SessionExportSchema>;

const OMITTED_RUNTIME_PATHS = [
  "session.userId",
  "session.sessionId",
  "session.projectRoot",
  "session.command",
  "session.args",
  "session.env",
  "session.cwd",
  "session.commands",
  "session.agentCapabilities",
  "session.authMethods",
] as const;

export function buildRedactedSessionExport(
  session: StoredSession,
  exportedAt = new Date()
): SessionExport {
  const redactions: SessionExport["redactions"] = [];
  const exportPayload: SessionExport = {
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    redactionPolicyVersion: SESSION_EXPORT_REDACTION_POLICY_VERSION,
    exportedAt: exportedAt.toISOString(),
    redactions,
    session: {
      id: session.id,
      ...(session.name ? { name: session.name } : {}),
      ...(session.agentId ? { agentId: session.agentId } : {}),
      ...(session.agentName ? { agentName: session.agentName } : {}),
      ...(session.projectId ? { projectId: session.projectId } : {}),
      status: session.status,
      ...(session.pinned !== undefined ? { pinned: session.pinned } : {}),
      ...(session.archived !== undefined ? { archived: session.archived } : {}),
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      ...(session.modeId ? { modeId: session.modeId } : {}),
      ...(session.modelId ? { modelId: session.modelId } : {}),
      messageCount: session.messageCount ?? session.messages.length,
      messages: session.messages.map((message, index) =>
        redactStoredMessage(message, `session.messages[${index}]`, redactions)
      ),
      ...(session.plan
        ? {
            plan: {
              entries: session.plan.entries.map((entry, index) => ({
                priority: entry.priority,
                status: entry.status,
                content: recordRedaction(
                  redactions,
                  `session.plan.entries[${index}].content`,
                  createRedactedValue("message_content", entry.content)
                ),
              })),
            },
          }
        : {}),
    },
  };

  for (const path of OMITTED_RUNTIME_PATHS) {
    const reason =
      path === "session.projectRoot" || path === "session.cwd"
        ? "filesystem_path"
        : path === "session.commands"
          ? "structured_payload"
          : path === "session.userId" ||
              path === "session.sessionId" ||
              path === "session.agentCapabilities" ||
              path === "session.authMethods"
            ? "runtime_metadata"
            : "credential";
    recordRedaction(redactions, path, {
      kind: "redacted",
      reason,
      summary: "omitted",
    });
  }

  return SessionExportSchema.parse(exportPayload);
}

function redactStoredMessage(
  message: StoredMessage,
  path: string,
  redactions: SessionExport["redactions"]
): SessionExport["session"]["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    ...(message.isCompacted !== undefined
      ? { isCompacted: message.isCompacted }
      : {}),
    content: recordRedaction(
      redactions,
      `${path}.content`,
      createRedactedValue("message_content", message.content)
    ),
    ...(message.contentBlocks
      ? {
          contentBlocks: message.contentBlocks.map((block, index) =>
            recordRedaction(
              redactions,
              `${path}.contentBlocks[${index}]`,
              createRedactedValue("structured_payload", block)
            )
          ),
        }
      : {}),
    ...(message.reasoning
      ? {
          reasoning: recordRedaction(
            redactions,
            `${path}.reasoning`,
            createRedactedValue("message_content", message.reasoning)
          ),
        }
      : {}),
    ...(message.reasoningBlocks
      ? {
          reasoningBlocks: message.reasoningBlocks.map((block, index) =>
            recordRedaction(
              redactions,
              `${path}.reasoningBlocks[${index}]`,
              createRedactedValue("structured_payload", block)
            )
          ),
        }
      : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((toolCall, index) => ({
            name: toolCall.name,
            args: recordRedaction(
              redactions,
              `${path}.toolCalls[${index}].args`,
              createRedactedValue("structured_payload", toolCall.args)
            ),
          })),
        }
      : {}),
    ...(message.parts
      ? {
          parts: message.parts.map((part, index) =>
            recordRedaction(
              redactions,
              `${path}.parts[${index}]`,
              createRedactedValue("structured_payload", part)
            )
          ),
        }
      : {}),
  };
}

function recordRedaction(
  redactions: SessionExport["redactions"],
  path: string,
  value: RedactedValue
): RedactedValue {
  redactions.push({ path, value });
  return value;
}
