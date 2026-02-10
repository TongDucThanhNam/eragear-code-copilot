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
  isRecord,
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

  private parseAgentInfoLight(raw: unknown): StoredSession["agentInfo"] {
    const parsed = this.decodeListJsonWithCache(raw);
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
    const parsed = this.decodeListJsonWithCache(raw);
    if (!(isRecord(parsed) && Array.isArray(parsed.entries))) {
      return undefined;
    }

    const entries = parsed.entries.map((entry) =>
      isRecord(entry) ? { ...entry } : entry
    );
    const rawMeta = "_meta" in parsed ? parsed._meta : undefined;
    let meta: Record<string, unknown> | null | undefined;
    if (rawMeta === null) {
      meta = null;
    } else if (isRecord(rawMeta)) {
      meta = { ...rawMeta };
    } else {
      meta = undefined;
    }

    return {
      _meta: meta,
      entries: entries as NonNullable<StoredSession["plan"]>["entries"],
    };
  }

  private parseAgentCapabilitiesLight(
    raw: unknown
  ): StoredSession["agentCapabilities"] {
    const parsed = this.decodeListJsonWithCache(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return { ...parsed };
  }

  private parseAuthMethodsLight(raw: unknown): StoredSession["authMethods"] {
    const parsed = this.decodeListJsonWithCache(raw);
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
}
