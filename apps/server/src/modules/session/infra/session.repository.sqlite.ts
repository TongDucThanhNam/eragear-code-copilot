/**
 * Session Repository (SQLite-backed via Drizzle ORM)
 */

import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
} from "@/config/constants";
import { getSqliteOrm, sqliteSchema } from "@/platform/storage/sqlite-db";
import {
  getSqliteDb,
  getSqliteStorageStats,
  runInSqliteTransaction,
} from "@/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "@/platform/storage/sqlite-write-queue";
import { systemClock } from "@/platform/time/system-clock";
import { NotFoundError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import type {
  SessionListPageQuery,
  SessionListPageResult,
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "../application/ports/session-repository.port";
import { compactSessionMessagesInSqlite } from "./session.repository.sqlite.compaction";
import {
  listSessionsByCursorFromSqlite,
  listSessionsFromSqlite,
} from "./session.repository.sqlite.list";
import {
  type MessageInsert,
  type SessionInsert,
  SessionSqliteMapper,
} from "./session-sqlite.mapper";

export interface SessionSqliteRepositoryPolicy {
  sessionListPageMaxLimit: number;
  sessionMessagesPageMaxLimit: number;
}

interface SessionSqliteRepositoryDeps {
  mapper?: SessionSqliteMapper;
  clock?: ClockPort;
  policy?: SessionSqliteRepositoryPolicy;
  policyProvider?: () => SessionSqliteRepositoryPolicy;
}

const DEFAULT_POLICY: SessionSqliteRepositoryPolicy = {
  sessionListPageMaxLimit: DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  sessionMessagesPageMaxLimit: DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
};

const SQLITE_SESSION_OP = {
  CREATE: "session.create",
  UPDATE_STATUS: "session.update_status",
  UPDATE_METADATA: "session.update_metadata",
  DELETE: "session.delete",
  APPEND_MESSAGE: "session.append_message",
  COMPACT_MESSAGES: "session.compact_messages",
} as const;

function normalizePolicy(
  policy: SessionSqliteRepositoryPolicy
): SessionSqliteRepositoryPolicy {
  return {
    sessionListPageMaxLimit: Math.max(
      1,
      Math.trunc(policy.sessionListPageMaxLimit)
    ),
    sessionMessagesPageMaxLimit: Math.max(
      1,
      Math.trunc(policy.sessionMessagesPageMaxLimit)
    ),
  };
}

function isSqliteForeignKeyError(error: unknown): boolean {
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }
    const errorText = `${current.name} ${current.message}`.toUpperCase();
    if (
      errorText.includes("SQLITE_CONSTRAINT_FOREIGNKEY") ||
      errorText.includes("FOREIGN KEY CONSTRAINT FAILED")
    ) {
      return true;
    }
    if (current instanceof AggregateError) {
      queue.push(...current.errors);
    }
    if ("cause" in current && current.cause !== undefined) {
      queue.push(current.cause);
    }
  }
  return false;
}

export class SessionSqliteRepository implements SessionRepositoryPort {
  private readonly mapper: SessionSqliteMapper;
  private readonly clock: ClockPort;
  private readonly policyProvider: () => SessionSqliteRepositoryPolicy;

  constructor(deps: SessionSqliteRepositoryDeps = {}) {
    this.mapper = deps.mapper ?? new SessionSqliteMapper();
    this.clock = deps.clock ?? systemClock;
    const staticPolicy = normalizePolicy(deps.policy ?? DEFAULT_POLICY);
    const dynamicPolicyProvider = deps.policyProvider;
    if (dynamicPolicyProvider) {
      this.policyProvider = () => normalizePolicy(dynamicPolicyProvider());
    } else {
      this.policyProvider = () => staticPolicy;
    }
  }

  private getPolicy(): SessionSqliteRepositoryPolicy {
    return this.policyProvider();
  }

  async findById(
    id: string,
    userId: string
  ): Promise<StoredSession | undefined> {
    const db = await getSqliteOrm();
    const row = db
      .select()
      .from(sqliteSchema.sessions)
      .where(
        and(
          eq(sqliteSchema.sessions.id, id),
          eq(sqliteSchema.sessions.userId, userId)
        )
      )
      .get();
    if (!row) {
      return undefined;
    }
    return this.mapper.mapSessionRow(row);
  }

  findAll(userId: string, query?: SessionListQuery): Promise<StoredSession[]> {
    return listSessionsFromSqlite({
      mapper: this.mapper,
      policy: this.getPolicy(),
      query,
      whereClause: eq(sqliteSchema.sessions.userId, userId),
    });
  }

  findAllForMaintenance(query?: SessionListQuery): Promise<StoredSession[]> {
    return listSessionsFromSqlite({
      mapper: this.mapper,
      policy: this.getPolicy(),
      query,
    });
  }

  findPage(
    userId: string,
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return listSessionsByCursorFromSqlite({
      mapper: this.mapper,
      policy: this.getPolicy(),
      query,
      whereClause: eq(sqliteSchema.sessions.userId, userId),
    });
  }

  findPageForMaintenance(
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return listSessionsByCursorFromSqlite({
      mapper: this.mapper,
      policy: this.getPolicy(),
      query,
    });
  }

  async countAll(userId: string): Promise<number> {
    const db = await getSqliteOrm();
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(sqliteSchema.sessions)
      .where(eq(sqliteSchema.sessions.userId, userId))
      .get();
    return Math.max(0, Number(row?.count ?? 0));
  }

  async create(session: StoredSession): Promise<void> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.CREATE, async () => {
      const orm = await getSqliteOrm();
      const sqliteDb = await getSqliteDb();

      runInSqliteTransaction(sqliteDb, () => {
        orm
          .insert(sqliteSchema.sessions)
          .values(this.mapper.toSessionInsert(session))
          .run();

        if (session.messages.length > 0) {
          const dedupedMessageById = new Map<string, MessageInsert>();
          for (const message of session.messages) {
            dedupedMessageById.set(
              message.id,
              this.mapper.toMessageInsert(session.id, message)
            );
          }
          const dedupedMessages = [...dedupedMessageById.values()];
          if (dedupedMessages.length > 0) {
            orm
              .insert(sqliteSchema.sessionMessages)
              .values(dedupedMessages)
              .run();
          }
        }
      });
    });
  }

  async updateStatus(
    id: string,
    userId: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.UPDATE_STATUS, async () => {
      const db = await getSqliteOrm();
      if (options?.touchLastActiveAt === true) {
        db.update(sqliteSchema.sessions)
          .set({ status, lastActiveAt: this.clock.nowMs() })
          .where(
            and(
              eq(sqliteSchema.sessions.id, id),
              eq(sqliteSchema.sessions.userId, userId)
            )
          )
          .run();
        return;
      }

      db.update(sqliteSchema.sessions)
        .set({ status })
        .where(
          and(
            eq(sqliteSchema.sessions.id, id),
            eq(sqliteSchema.sessions.userId, userId)
          )
        )
        .run();
    });
  }

  async updateMetadata(
    id: string,
    userId: string,
    updates: Partial<StoredSession>
  ): Promise<void> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.UPDATE_METADATA, async () => {
      const db = await getSqliteOrm();
      const setValues: Partial<SessionInsert> = {
        lastActiveAt: this.clock.nowMs(),
      };
      Object.assign(setValues, this.mapper.toMetadataUpdateSet(updates));

      db.update(sqliteSchema.sessions)
        .set(setValues)
        .where(
          and(
            eq(sqliteSchema.sessions.id, id),
            eq(sqliteSchema.sessions.userId, userId)
          )
        )
        .run();
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.DELETE, async () => {
      const db = await getSqliteOrm();
      db.delete(sqliteSchema.sessions)
        .where(
          and(
            eq(sqliteSchema.sessions.id, id),
            eq(sqliteSchema.sessions.userId, userId)
          )
        )
        .run();
    });
  }

  async appendMessage(
    id: string,
    userId: string,
    message: StoredMessage
  ): Promise<{ appended: true }> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.APPEND_MESSAGE, async () => {
      const orm = await getSqliteOrm();
      const sqliteDb = await getSqliteDb();
      try {
        runInSqliteTransaction(sqliteDb, () => {
          const values = this.mapper.toMessageInsert(id, message);
          orm
            .insert(sqliteSchema.sessionMessages)
            .values(values)
            .onConflictDoUpdate({
              target: [
                sqliteSchema.sessionMessages.sessionId,
                sqliteSchema.sessionMessages.messageId,
              ],
              set: {
                role: values.role,
                content: values.content,
                contentBlocksJson: values.contentBlocksJson,
                timestamp: values.timestamp,
                toolCallsJson: values.toolCallsJson,
                reasoning: values.reasoning,
                reasoningBlocksJson: values.reasoningBlocksJson,
                partsJson: values.partsJson,
                storageTier: values.storageTier,
                retainedPayload: values.retainedPayload,
                compactedAt: values.compactedAt,
              },
            })
            .run();

          orm
            .update(sqliteSchema.sessions)
            .set({
              lastActiveAt: this.clock.nowMs(),
            })
            .where(
              and(
                eq(sqliteSchema.sessions.id, id),
                eq(sqliteSchema.sessions.userId, userId)
              )
            )
            .run();
        });
      } catch (error) {
        if (isSqliteForeignKeyError(error)) {
          throw new NotFoundError("Chat not found", {
            module: "session",
            op: SQLITE_SESSION_OP.APPEND_MESSAGE,
            details: { chatId: id },
          });
        }
        throw error;
      }
    });
    return { appended: true };
  }

  async getMessagesPage(
    id: string,
    userId: string,
    query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    const db = await getSqliteOrm();
    const policy = this.getPolicy();
    const limit = Math.max(
      1,
      Math.min(
        policy.sessionMessagesPageMaxLimit,
        Math.trunc(query.limit ?? policy.sessionMessagesPageMaxLimit)
      )
    );
    const cursor =
      query.cursor === undefined
        ? undefined
        : Math.max(0, Math.trunc(query.cursor));
    const includeCompacted = query.includeCompacted ?? true;

    let whereClause = and(
      eq(sqliteSchema.sessionMessages.sessionId, id),
      eq(sqliteSchema.sessions.userId, userId)
    );
    if (cursor !== undefined) {
      whereClause = and(
        whereClause,
        gt(sqliteSchema.sessionMessages.seq, cursor)
      ) as typeof whereClause;
    }
    if (!includeCompacted) {
      whereClause = and(
        whereClause,
        eq(sqliteSchema.sessionMessages.retainedPayload, 1)
      ) as typeof whereClause;
    }

    const rows = db
      .select()
      .from(sqliteSchema.sessionMessages)
      .innerJoin(
        sqliteSchema.sessions,
        eq(sqliteSchema.sessionMessages.sessionId, sqliteSchema.sessions.id)
      )
      .where(whereClause)
      .orderBy(asc(sqliteSchema.sessionMessages.seq))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? Number(pageRows.at(-1)?.session_messages.seq ?? cursor ?? 0)
      : undefined;
    return {
      messages: pageRows.map((row) =>
        this.mapper.mapMessageRow(row.session_messages)
      ),
      nextCursor,
      hasMore,
    };
  }

  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }> {
    const cutoff = Math.max(0, Math.trunc(input.beforeTimestamp));
    const batchSize = Math.max(1, Math.trunc(input.batchSize));
    const sessionIds = [...new Set(input.sessionIds)]
      .map((sessionId) => sessionId.trim())
      .filter((sessionId) => sessionId.length > 0);
    if (sessionIds.length === 0) {
      return Promise.resolve({ compacted: 0 });
    }

    return enqueueSqliteWrite(
      SQLITE_SESSION_OP.COMPACT_MESSAGES,
      async () =>
        await compactSessionMessagesInSqlite({
          sessionIds,
          cutoffTimestamp: cutoff,
          batchSize,
          clock: this.clock,
        }),
      { priority: "low" }
    );
  }

  async getStorageStats(): Promise<SessionStorageStats> {
    const stats = await getSqliteStorageStats();
    return {
      dbSizeBytes: stats.dbSizeBytes,
      walSizeBytes: stats.walSizeBytes,
      freePages: stats.freePages,
      sessionCount: stats.sessionCount,
      messageCount: stats.messageCount,
      writeQueueDepth: stats.writeQueueDepth,
      pendingWriteQueueTotal: stats.pendingWriteQueueTotal,
      pendingWriteQueueHigh: stats.pendingWriteQueueHigh,
      pendingWriteQueueLow: stats.pendingWriteQueueLow,
      writeQueueFailures: stats.writeQueueFailures,
      workerRecycleCount: stats.workerRecycleCount,
      workerTimeoutCount: stats.workerTimeoutCount,
      workerLastRecycleReason: stats.workerLastRecycleReason,
      workerLastRecycleAt: stats.workerLastRecycleAt,
    };
  }
}
