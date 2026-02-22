import type { ZodType } from "zod";
import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";
import {
  fromSqliteBoolean,
  fromSqliteJsonWithSchema,
} from "@/platform/storage/sqlite-store";
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

function requireNonEmptyString(
  value: unknown,
  field: string,
  sessionId: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Session ${sessionId} has invalid ${field}`);
  }
  return value;
}

function assertValidTimestamp(
  value: unknown,
  field: string,
  sessionId: string
): number {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Session ${sessionId} has invalid ${field}`);
  }
  return Math.trunc(Number(value));
}

function assertValidStatus(
  value: unknown,
  sessionId: string
): "running" | "stopped" {
  if (value === "running" || value === "stopped") {
    return value;
  }
  throw new Error(`Session ${sessionId} has invalid status`);
}

function assertValidMessageCount(value: unknown, sessionId: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`Session ${sessionId} has invalid message count`);
  }
  return Math.trunc(normalized);
}

export class SessionSqliteReadMapper {
  private readonly listJsonDecodeCache = new Map<string, unknown>();

  mapSessionListRow(row: SessionListRow): StoredSession {
    const userId = requireNonEmptyString(row.userId, "owner", row.id);
    const projectRoot = requireNonEmptyString(
      row.projectRoot,
      "projectRoot",
      row.id
    );
    const createdAt = assertValidTimestamp(row.createdAt, "createdAt", row.id);
    const lastActiveAt = assertValidTimestamp(
      row.lastActiveAt,
      "lastActiveAt",
      row.id
    );
    const status = assertValidStatus(row.status, row.id);
    const messageCount = assertValidMessageCount(row.messageCount, row.id);
    return {
      id: row.id,
      userId,
      name: row.name ?? undefined,
      agentName: row.agentName ?? undefined,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      projectRoot,
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
      status,
      pinned: fromSqliteBoolean(row.pinned),
      archived: fromSqliteBoolean(row.archived),
      createdAt,
      lastActiveAt,
      modeId: row.modeId ?? undefined,
      modelId: row.modelId ?? undefined,
      messages: [],
      messageCount,
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
    const userId = requireNonEmptyString(row.userId, "owner", row.id);
    const projectRoot = requireNonEmptyString(
      row.projectRoot,
      "projectRoot",
      row.id
    );
    const createdAt = assertValidTimestamp(row.createdAt, "createdAt", row.id);
    const lastActiveAt = assertValidTimestamp(
      row.lastActiveAt,
      "lastActiveAt",
      row.id
    );
    const status = assertValidStatus(row.status, row.id);
    const messageCount = assertValidMessageCount(row.messageCount, row.id);
    return {
      id: row.id,
      userId,
      name: row.name ?? undefined,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      projectRoot,
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
      status,
      pinned: fromSqliteBoolean(row.pinned),
      archived: fromSqliteBoolean(row.archived),
      createdAt,
      lastActiveAt,
      modeId: row.modeId ?? undefined,
      modelId: row.modelId ?? undefined,
      messages: [],
      messageCount,
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

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = undefined;
    }
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
