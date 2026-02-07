import { z } from "zod";
import { ENV } from "@/config/environment";
import type { sqliteSchema } from "@/platform/storage/sqlite-db";
import {
  fromSqliteBoolean,
  fromSqliteJson,
  fromSqliteJsonWithSchema,
  toSqliteBoolean,
  toSqliteJson,
} from "@/platform/storage/sqlite-store";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";

export type SessionRow = typeof sqliteSchema.sessions.$inferSelect;
export type MessageRow = typeof sqliteSchema.sessionMessages.$inferSelect;
export type SessionInsert = typeof sqliteSchema.sessions.$inferInsert;
export type MessageInsert = typeof sqliteSchema.sessionMessages.$inferInsert;
export type SessionListRow = Pick<
  SessionRow,
  | "id"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string(), z.string());
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

const OptionalAgentInfoSchema = AgentInfoSchema.optional();
const OptionalPlanSchema = PlanSchema.optional();
const OptionalAvailableCommandsSchema = z
  .array(AvailableCommandSchema)
  .optional();
const OptionalAgentCapabilitiesSchema = AgentCapabilitiesSchema.optional();
const OptionalAuthMethodsSchema = z.array(AuthMethodSchema).optional();
const OptionalToolCallsSchema = z.array(ToolCallSchema).optional();
const OptionalContentBlocksSchema = z.custom<StoredMessage["contentBlocks"]>(
  (value) => value === undefined || Array.isArray(value)
);
const OptionalReasoningBlocksSchema = z.custom<
  StoredMessage["reasoningBlocks"]
>((value) => value === undefined || Array.isArray(value));
const OptionalPartsSchema = z.custom<StoredMessage["parts"]>(
  (value) => value === undefined || Array.isArray(value)
);

export class SessionSqliteMapper {
  private parseAgentInfoLight(raw: unknown): StoredSession["agentInfo"] {
    const parsed = fromSqliteJson<unknown>(raw, undefined);
    if (!isRecord(parsed)) {
      return undefined;
    }

    const name = typeof parsed.name === "string" ? parsed.name : undefined;
    const title = typeof parsed.title === "string" ? parsed.title : undefined;
    const version =
      typeof parsed.version === "string" ? parsed.version : undefined;

    if (!(name || title || version)) {
      return undefined;
    }
    return { name, title, version };
  }

  private parsePlanLight(raw: unknown): StoredSession["plan"] {
    const parsed = fromSqliteJson<unknown>(raw, undefined);
    if (!(isRecord(parsed) && Array.isArray(parsed.entries))) {
      return undefined;
    }
    return parsed as unknown as StoredSession["plan"];
  }

  private parseAgentCapabilitiesLight(
    raw: unknown
  ): StoredSession["agentCapabilities"] {
    const parsed = fromSqliteJson<unknown>(raw, undefined);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  }

  private parseAuthMethodsLight(raw: unknown): StoredSession["authMethods"] {
    const parsed = fromSqliteJson<unknown>(raw, undefined);
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const methods = parsed
      .map((entry) => {
        if (!isRecord(entry)) {
          return undefined;
        }
        if (
          typeof entry.name !== "string" ||
          typeof entry.id !== "string" ||
          typeof entry.description !== "string"
        ) {
          return undefined;
        }
        return {
          name: entry.name,
          id: entry.id,
          description: entry.description,
        };
      })
      .filter((entry) => entry !== undefined);

    if (methods.length !== parsed.length) {
      return undefined;
    }
    return methods;
  }

  protected mapSessionListRow(row: SessionListRow): StoredSession {
    return {
      id: row.id,
      name: row.name ?? undefined,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      projectRoot: row.projectRoot,
      command: undefined,
      args: undefined,
      env: undefined,
      cwd: undefined,
      loadSessionSupported: fromSqliteBoolean(row.loadSessionSupported),
      useUnstableResume: fromSqliteBoolean(row.useUnstableResume),
      supportsModelSwitching: fromSqliteBoolean(row.supportsModelSwitching),
      agentInfo: this.parseAgentInfoLight(row.agentInfoJson),
      status: row.status === "running" ? "running" : "stopped",
      pinned: fromSqliteBoolean(row.pinned),
      archived: fromSqliteBoolean(row.archived),
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      modeId: row.modeId ?? undefined,
      modelId: row.modelId ?? undefined,
      messages: [],
      messageCount: row.messageCount,
      plan: this.parsePlanLight(row.planJson),
      commands: undefined,
      agentCapabilities: this.parseAgentCapabilitiesLight(
        row.agentCapabilitiesJson
      ),
      authMethods: this.parseAuthMethodsLight(row.authMethodsJson),
    };
  }

  protected mapSessionRow(row: SessionRow): StoredSession {
    return {
      id: row.id,
      name: row.name ?? undefined,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      projectRoot: row.projectRoot,
      command: row.command ?? undefined,
      args: fromSqliteJsonWithSchema(row.argsJson, [], StringArraySchema, {
        table: "sessions",
        column: "args_json",
      }),
      env: fromSqliteJsonWithSchema(row.envJson, {}, StringRecordSchema, {
        table: "sessions",
        column: "env_json",
      }),
      cwd: row.cwd ?? undefined,
      loadSessionSupported: fromSqliteBoolean(row.loadSessionSupported),
      useUnstableResume: fromSqliteBoolean(row.useUnstableResume),
      supportsModelSwitching: fromSqliteBoolean(row.supportsModelSwitching),
      agentInfo: fromSqliteJsonWithSchema(
        row.agentInfoJson,
        undefined,
        OptionalAgentInfoSchema,
        {
          table: "sessions",
          column: "agent_info_json",
        }
      ),
      status: row.status === "running" ? "running" : "stopped",
      pinned: fromSqliteBoolean(row.pinned),
      archived: fromSqliteBoolean(row.archived),
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      modeId: row.modeId ?? undefined,
      modelId: row.modelId ?? undefined,
      messages: [],
      messageCount: row.messageCount,
      plan: fromSqliteJsonWithSchema(
        row.planJson,
        undefined,
        OptionalPlanSchema,
        {
          table: "sessions",
          column: "plan_json",
        }
      ),
      commands: fromSqliteJsonWithSchema(
        row.commandsJson,
        undefined,
        OptionalAvailableCommandsSchema,
        {
          table: "sessions",
          column: "commands_json",
        }
      ),
      agentCapabilities: fromSqliteJsonWithSchema(
        row.agentCapabilitiesJson,
        undefined,
        OptionalAgentCapabilitiesSchema,
        {
          table: "sessions",
          column: "agent_capabilities_json",
        }
      ),
      authMethods: fromSqliteJsonWithSchema(
        row.authMethodsJson,
        undefined,
        OptionalAuthMethodsSchema,
        {
          table: "sessions",
          column: "auth_methods_json",
        }
      ),
    };
  }

  protected mapMessageRow(row: MessageRow): StoredMessage {
    return {
      id: row.messageId,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      contentBlocks: fromSqliteJsonWithSchema(
        row.contentBlocksJson,
        undefined,
        OptionalContentBlocksSchema,
        {
          table: "session_messages",
          column: "content_blocks_json",
        }
      ),
      timestamp: row.timestamp,
      toolCalls: fromSqliteJsonWithSchema(
        row.toolCallsJson,
        undefined,
        OptionalToolCallsSchema,
        {
          table: "session_messages",
          column: "tool_calls_json",
        }
      ),
      reasoning: row.reasoning ?? undefined,
      reasoningBlocks: fromSqliteJsonWithSchema(
        row.reasoningBlocksJson,
        undefined,
        OptionalReasoningBlocksSchema,
        {
          table: "session_messages",
          column: "reasoning_blocks_json",
        }
      ),
      parts: fromSqliteJsonWithSchema(
        row.partsJson,
        undefined,
        OptionalPartsSchema,
        {
          table: "session_messages",
          column: "parts_json",
        }
      ),
      isCompacted: Number(row.retainedPayload ?? 1) !== 1,
    };
  }

  protected toSessionInsert(session: StoredSession): SessionInsert {
    return {
      id: session.id,
      name: session.name ?? null,
      sessionId: session.sessionId ?? null,
      projectId: session.projectId ?? null,
      projectRoot: session.projectRoot,
      command: session.command ?? null,
      argsJson: toSqliteJson(session.args),
      envJson: toSqliteJson(session.env),
      cwd: session.cwd ?? null,
      loadSessionSupported: toSqliteBoolean(session.loadSessionSupported),
      useUnstableResume: toSqliteBoolean(session.useUnstableResume),
      supportsModelSwitching: toSqliteBoolean(session.supportsModelSwitching),
      agentInfoJson: toSqliteJson(session.agentInfo),
      status: session.status === "running" ? "running" : "stopped",
      pinned: toSqliteBoolean(session.pinned),
      archived: toSqliteBoolean(session.archived),
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      modeId: session.modeId ?? null,
      modelId: session.modelId ?? null,
      planJson: toSqliteJson(session.plan),
      commandsJson: toSqliteJson(session.commands),
      agentCapabilitiesJson: toSqliteJson(session.agentCapabilities),
      authMethodsJson: toSqliteJson(session.authMethods),
      messageCount: 0,
    };
  }

  protected toMessageInsert(
    sessionId: string,
    message: StoredMessage
  ): MessageInsert {
    this.assertMessagePayloadBudget(message);
    return {
      sessionId,
      messageId: message.id,
      role: message.role,
      content: message.content,
      contentBlocksJson: toSqliteJson(message.contentBlocks),
      timestamp: message.timestamp,
      toolCallsJson: toSqliteJson(message.toolCalls),
      reasoning: message.reasoning ?? null,
      reasoningBlocksJson: toSqliteJson(message.reasoningBlocks),
      partsJson: toSqliteJson(message.parts),
      storageTier: "hot",
      retainedPayload: 1,
      compactedAt: null,
    };
  }

  protected toSessionSaveUpdateSet(
    session: StoredSession
  ): Partial<SessionInsert> {
    const setValues: Partial<SessionInsert> = {
      projectRoot: session.projectRoot,
      status: session.status === "running" ? "running" : "stopped",
      lastActiveAt: session.lastActiveAt,
    };

    if (session.name !== undefined) {
      setValues.name = session.name;
    }
    if (session.sessionId !== undefined) {
      setValues.sessionId = session.sessionId;
    }
    if (session.projectId !== undefined) {
      setValues.projectId = session.projectId;
    }
    if (session.command !== undefined) {
      setValues.command = session.command;
    }
    if (session.args !== undefined) {
      setValues.argsJson = toSqliteJson(session.args);
    }
    if (session.env !== undefined) {
      setValues.envJson = toSqliteJson(session.env);
    }
    if (session.cwd !== undefined) {
      setValues.cwd = session.cwd;
    }
    if (session.loadSessionSupported !== undefined) {
      setValues.loadSessionSupported = toSqliteBoolean(
        session.loadSessionSupported
      );
    }
    if (session.useUnstableResume !== undefined) {
      setValues.useUnstableResume = toSqliteBoolean(session.useUnstableResume);
    }
    if (session.supportsModelSwitching !== undefined) {
      setValues.supportsModelSwitching = toSqliteBoolean(
        session.supportsModelSwitching
      );
    }
    if (session.agentInfo !== undefined) {
      setValues.agentInfoJson = toSqliteJson(session.agentInfo);
    }
    if (session.pinned !== undefined) {
      setValues.pinned = toSqliteBoolean(session.pinned);
    }
    if (session.archived !== undefined) {
      setValues.archived = toSqliteBoolean(session.archived);
    }
    if (session.modeId !== undefined) {
      setValues.modeId = session.modeId;
    }
    if (session.modelId !== undefined) {
      setValues.modelId = session.modelId;
    }
    if (session.plan !== undefined) {
      setValues.planJson = toSqliteJson(session.plan);
    }
    if (session.commands !== undefined) {
      setValues.commandsJson = toSqliteJson(session.commands);
    }
    if (session.agentCapabilities !== undefined) {
      setValues.agentCapabilitiesJson = toSqliteJson(session.agentCapabilities);
    }
    if (session.authMethods !== undefined) {
      setValues.authMethodsJson = toSqliteJson(session.authMethods);
    }

    return setValues;
  }

  protected toMetadataUpdateSet(
    updates: Partial<StoredSession>
  ): Partial<SessionInsert> {
    const setValues: Partial<SessionInsert> = {};
    this.applyIdentityMetadataUpdates(setValues, updates);
    this.applyCapabilityMetadataUpdates(setValues, updates);
    this.applyModelMetadataUpdates(setValues, updates);
    return setValues;
  }

  private assertMessagePayloadBudget(message: StoredMessage): void {
    const contentBytes = Buffer.byteLength(message.content ?? "", "utf8");
    if (contentBytes > ENV.messageContentMaxBytes) {
      throw new Error(
        `Message content exceeds max size: ${contentBytes} bytes > ${ENV.messageContentMaxBytes}`
      );
    }

    const partsBytes = Buffer.byteLength(
      JSON.stringify(message.parts ?? []),
      "utf8"
    );
    if (partsBytes > ENV.messagePartsMaxBytes) {
      throw new Error(
        `Message parts payload exceeds max size: ${partsBytes} bytes > ${ENV.messagePartsMaxBytes}`
      );
    }
  }

  private applyIdentityMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("name" in updates) {
      setValues.name = updates.name ?? null;
    }
    if ("sessionId" in updates) {
      setValues.sessionId = updates.sessionId ?? null;
    }
    if ("projectId" in updates) {
      setValues.projectId = updates.projectId ?? null;
    }
    if ("projectRoot" in updates && updates.projectRoot) {
      setValues.projectRoot = updates.projectRoot;
    }
    if ("command" in updates) {
      setValues.command = updates.command ?? null;
    }
    if ("args" in updates) {
      setValues.argsJson = toSqliteJson(updates.args);
    }
    if ("env" in updates) {
      setValues.envJson = toSqliteJson(updates.env);
    }
    if ("cwd" in updates) {
      setValues.cwd = updates.cwd ?? null;
    }
  }

  private applyCapabilityMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("loadSessionSupported" in updates) {
      setValues.loadSessionSupported = toSqliteBoolean(
        updates.loadSessionSupported
      );
    }
    if ("useUnstableResume" in updates) {
      setValues.useUnstableResume = toSqliteBoolean(updates.useUnstableResume);
    }
    if ("supportsModelSwitching" in updates) {
      setValues.supportsModelSwitching = toSqliteBoolean(
        updates.supportsModelSwitching
      );
    }
    if ("agentInfo" in updates) {
      setValues.agentInfoJson = toSqliteJson(updates.agentInfo);
    }
    if ("status" in updates) {
      setValues.status = updates.status === "running" ? "running" : "stopped";
    }
    if ("pinned" in updates) {
      setValues.pinned = toSqliteBoolean(updates.pinned);
    }
    if ("archived" in updates) {
      setValues.archived = toSqliteBoolean(updates.archived);
    }
  }

  private applyModelMetadataUpdates(
    setValues: Partial<SessionInsert>,
    updates: Partial<StoredSession>
  ): void {
    if ("createdAt" in updates && typeof updates.createdAt === "number") {
      setValues.createdAt = updates.createdAt;
    }
    if ("modeId" in updates) {
      setValues.modeId = updates.modeId ?? null;
    }
    if ("modelId" in updates) {
      setValues.modelId = updates.modelId ?? null;
    }
    if ("plan" in updates) {
      setValues.planJson = toSqliteJson(updates.plan);
    }
    if ("commands" in updates) {
      setValues.commandsJson = toSqliteJson(updates.commands);
    }
    if ("agentCapabilities" in updates) {
      setValues.agentCapabilitiesJson = toSqliteJson(updates.agentCapabilities);
    }
    if ("authMethods" in updates) {
      setValues.authMethodsJson = toSqliteJson(updates.authMethods);
    }
  }
}
