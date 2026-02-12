import { z } from "zod";
import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import type { sqliteSchema } from "@/platform/storage/sqlite-db";

export type SessionRow = typeof sqliteSchema.sessions.$inferSelect;
export type MessageRow = typeof sqliteSchema.sessionMessages.$inferSelect;
export type SessionInsert = typeof sqliteSchema.sessions.$inferInsert;
export type MessageInsert = typeof sqliteSchema.sessionMessages.$inferInsert;
export type SessionListRow = Pick<
  SessionRow,
  | "id"
  | "userId"
  | "name"
  | "sessionId"
  | "projectId"
  | "projectRoot"
  | "loadSessionSupported"
  | "useUnstableResume"
  | "supportsModelSwitching"
  | "agentInfoJson"
  | "status"
  | "pinned"
  | "archived"
  | "createdAt"
  | "lastActiveAt"
  | "modeId"
  | "modelId"
  | "messageCount"
  | "planJson"
  | "agentCapabilitiesJson"
  | "authMethodsJson"
>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const StringArraySchema = z.array(z.string());
export const StringRecordSchema = z.record(z.string(), z.string());

const ToolCallSchema = z.object({
  name: z.string(),
  args: z.unknown(),
});

const AgentInfoSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    version: z.string().optional(),
  })
  .partial();

const AvailableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string(),
    })
    .nullable()
    .optional(),
});

const PlanEntrySchema = z.object({
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "in_progress", "completed"]),
});

const PlanSchema = z.object({
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
  entries: z.array(PlanEntrySchema),
});

const AuthMethodSchema = z.object({
  name: z.string(),
  id: z.string(),
  description: z.string(),
});

const AgentCapabilitiesSchema = z.record(z.string(), z.unknown());

export const OptionalAgentInfoSchema = AgentInfoSchema.optional();
export const OptionalPlanSchema = PlanSchema.optional();
export const OptionalAvailableCommandsSchema = z
  .array(AvailableCommandSchema)
  .optional();
export const OptionalAgentCapabilitiesSchema =
  AgentCapabilitiesSchema.optional();
export const OptionalAuthMethodsSchema = z.array(AuthMethodSchema).optional();
export const OptionalToolCallsSchema = z.array(ToolCallSchema).optional();

export const OptionalContentBlocksSchema = z.custom<
  StoredMessage["contentBlocks"]
>((value) => value === undefined || Array.isArray(value));

export const OptionalReasoningBlocksSchema = z.custom<
  StoredMessage["reasoningBlocks"]
>((value) => value === undefined || Array.isArray(value));

export const OptionalPartsSchema = z.custom<StoredMessage["parts"]>(
  (value) => value === undefined || Array.isArray(value)
);

export const MAX_LIST_JSON_CACHE_ENTRIES = 1024;
