import type { ZodType } from "zod";
import {
  fromSqliteBoolean,
  fromSqliteJson,
  fromSqliteJsonWithSchema,
} from "@/platform/storage/sqlite-store";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import {
  MAX_LIST_JSON_CACHE_ENTRIES,
  type MessageRow,
  OptionalAgentCapabilitiesSchema,
  OptionalAgentInfoSchema,
  OptionalAuthMethodsSchema,
  OptionalAvailableCommandsSchema,
  OptionalContentBlocksSchema,
  OptionalPartsSchema,
  OptionalPlanSchema,
  OptionalReasoningBlocksSchema,
  OptionalToolCallsSchema,
  type SessionListRow,
  type SessionRow,
  StringArraySchema,
  StringRecordSchema,
} from "./session-sqlite.mapper.types";

export class SessionSqliteReadMapper {
  private readonly listJsonDecodeCache = new Map<string, unknown>();

  mapSessionListRow(row: SessionListRow): StoredSession {
    if (!row.userId) {
      throw new Error(`Session ${row.id} is missing owner`);
    }
    return {
      id: row.id,
      userId: row.userId,
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
      agentInfo: this.parseListJsonWithSchema(
        row.agentInfoJson,
        OptionalAgentInfoSchema
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
      plan: this.parseListJsonWithSchema(row.planJson, OptionalPlanSchema),
      commands: undefined,
      agentCapabilities: this.parseListJsonWithSchema(
        row.agentCapabilitiesJson,
        OptionalAgentCapabilitiesSchema
      ),
      authMethods: this.parseListJsonWithSchema(
        row.authMethodsJson,
        OptionalAuthMethodsSchema
      ),
    };
  }

  mapSessionRow(row: SessionRow): StoredSession {
    if (!row.userId) {
      throw new Error(`Session ${row.id} is missing owner`);
    }
    return {
      id: row.id,
      userId: row.userId,
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

  mapMessageRow(row: MessageRow): StoredMessage {
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

  private decodeListJsonWithCache(raw: unknown): unknown {
    if (typeof raw !== "string" || raw.length === 0) {
      return undefined;
    }

    if (this.listJsonDecodeCache.has(raw)) {
      const cached = this.listJsonDecodeCache.get(raw);
      this.listJsonDecodeCache.delete(raw);
      this.listJsonDecodeCache.set(raw, cached);
      return cached;
    }

    const decoded = fromSqliteJson<unknown>(raw, undefined);
    this.listJsonDecodeCache.set(raw, decoded);
    if (this.listJsonDecodeCache.size > MAX_LIST_JSON_CACHE_ENTRIES) {
      const oldestKey = this.listJsonDecodeCache.keys().next().value;
      if (typeof oldestKey === "string") {
        this.listJsonDecodeCache.delete(oldestKey);
      }
    }

    return decoded;
  }

  private parseListJsonWithSchema<T>(
    raw: unknown,
    schema: ZodType<T>
  ): T | undefined {
    const decoded = this.decodeListJsonWithCache(raw);
    if (decoded === undefined) {
      return undefined;
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      return undefined;
    }
    return this.cloneValue(parsed.data);
  }

  private cloneValue<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }
    return structuredClone(value);
  }
}
