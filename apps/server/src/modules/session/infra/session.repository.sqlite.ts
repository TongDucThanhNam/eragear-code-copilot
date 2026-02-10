/**
 * Session Repository (SQLite-backed via Drizzle ORM)
 */

import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
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
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "../application/ports/session-repository.port";
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
}

const DEFAULT_POLICY: SessionSqliteRepositoryPolicy = {
  sessionListPageMaxLimit: DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  sessionMessagesPageMaxLimit: DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
};

const SQLITE_SESSION_OP = {
  SAVE: "session.save",
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

export class SessionSqliteRepository implements SessionRepositoryPort {
  private readonly mapper: SessionSqliteMapper;
  private readonly clock: ClockPort;
  private readonly policy: SessionSqliteRepositoryPolicy;

  constructor(deps: SessionSqliteRepositoryDeps = {}) {
    this.mapper = deps.mapper ?? new SessionSqliteMapper();
    this.clock = deps.clock ?? systemClock;
    this.policy = normalizePolicy(deps.policy ?? DEFAULT_POLICY);
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
    return this.listSessions(query, eq(sqliteSchema.sessions.userId, userId));
  }

  findAllForMaintenance(query?: SessionListQuery): Promise<StoredSession[]> {
    return this.listSessions(query);
  }

  private async listSessions(
    query?: SessionListQuery,
    whereClause?: SQL<unknown>
  ): Promise<StoredSession[]> {
    const db = await getSqliteOrm();
    const offset = Math.max(0, Math.trunc(query?.offset ?? 0));
    const rawLimit = query?.limit;
    const limit =
      rawLimit === undefined
        ? undefined
        : Math.max(
            1,
            Math.min(this.policy.sessionListPageMaxLimit, Math.trunc(rawLimit))
          );

    let select = db
      .select({
        id: sqliteSchema.sessions.id,
        userId: sqliteSchema.sessions.userId,
        name: sqliteSchema.sessions.name,
        sessionId: sqliteSchema.sessions.sessionId,
        projectId: sqliteSchema.sessions.projectId,
        projectRoot: sqliteSchema.sessions.projectRoot,
        loadSessionSupported: sqliteSchema.sessions.loadSessionSupported,
        useUnstableResume: sqliteSchema.sessions.useUnstableResume,
        supportsModelSwitching: sqliteSchema.sessions.supportsModelSwitching,
        agentInfoJson: sqliteSchema.sessions.agentInfoJson,
        status: sqliteSchema.sessions.status,
        pinned: sqliteSchema.sessions.pinned,
        archived: sqliteSchema.sessions.archived,
        createdAt: sqliteSchema.sessions.createdAt,
        lastActiveAt: sqliteSchema.sessions.lastActiveAt,
        modeId: sqliteSchema.sessions.modeId,
        modelId: sqliteSchema.sessions.modelId,
        messageCount: sqliteSchema.sessions.messageCount,
        planJson: sqliteSchema.sessions.planJson,
        agentCapabilitiesJson: sqliteSchema.sessions.agentCapabilitiesJson,
        authMethodsJson: sqliteSchema.sessions.authMethodsJson,
      })
      .from(sqliteSchema.sessions)
      .orderBy(desc(sqliteSchema.sessions.lastActiveAt))
      .$dynamic();
    if (whereClause) {
      select = select.where(whereClause);
    }

    if (limit !== undefined) {
      select = select.limit(limit);
    }
    if (offset > 0) {
      select = select.offset(offset);
    }

    const rows = select.all();
    return rows.map((row) => this.mapper.mapSessionListRow(row));
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

  async save(session: StoredSession): Promise<void> {
    await enqueueSqliteWrite(SQLITE_SESSION_OP.SAVE, async () => {
      const orm = await getSqliteOrm();
      const existing = orm
        .select({ id: sqliteSchema.sessions.id })
        .from(sqliteSchema.sessions)
        .where(eq(sqliteSchema.sessions.id, session.id))
        .get();
      const hasExisting = Boolean(existing);
      if (hasExisting && session.messages.length > 0) {
        throw new Error(
          "Session save does not support message snapshots for existing sessions; use appendMessage instead."
        );
      }

      const sqliteDb = await getSqliteDb();

      runInSqliteTransaction(sqliteDb, () => {
        orm
          .insert(sqliteSchema.sessions)
          .values(this.mapper.toSessionInsert(session))
          .onConflictDoUpdate({
            target: sqliteSchema.sessions.id,
            set: this.mapper.toSessionSaveUpdateSet(session),
          })
          .run();

        if (!hasExisting && session.messages.length > 0) {
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
              .onConflictDoUpdate({
                target: [
                  sqliteSchema.sessionMessages.sessionId,
                  sqliteSchema.sessionMessages.messageId,
                ],
                set: {
                  role: sql`excluded.role`,
                  content: sql`excluded.content`,
                  contentBlocksJson: sql`excluded.content_blocks_json`,
                  timestamp: sql`excluded.timestamp`,
                  toolCallsJson: sql`excluded.tool_calls_json`,
                  reasoning: sql`excluded.reasoning`,
                  reasoningBlocksJson: sql`excluded.reasoning_blocks_json`,
                  partsJson: sql`excluded.parts_json`,
                  storageTier: sql`excluded.storage_tier`,
                  retainedPayload: sql`excluded.retained_payload`,
                  compactedAt: sql`excluded.compacted_at`,
                },
              })
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

      const row = orm
        .select({ id: sqliteSchema.sessions.id })
        .from(sqliteSchema.sessions)
        .where(
          and(
            eq(sqliteSchema.sessions.id, id),
            eq(sqliteSchema.sessions.userId, userId)
          )
        )
        .get();
      if (!row) {
        throw new NotFoundError("Chat not found", {
          module: "session",
          op: SQLITE_SESSION_OP.APPEND_MESSAGE,
          details: { chatId: id },
        });
      }

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
    });
    return { appended: true };
  }

  async getMessagesPage(
    id: string,
    userId: string,
    query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    const db = await getSqliteOrm();
    const limit = Math.max(
      1,
      Math.min(
        this.policy.sessionMessagesPageMaxLimit,
        Math.trunc(query.limit ?? this.policy.sessionMessagesPageMaxLimit)
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
      async () => {
        const db = await getSqliteOrm();
        const rows = db
          .select({
            seq: sqliteSchema.sessionMessages.seq,
          })
          .from(sqliteSchema.sessionMessages)
          .where(
            and(
              inArray(sqliteSchema.sessionMessages.sessionId, sessionIds),
              lte(sqliteSchema.sessionMessages.timestamp, cutoff),
              eq(sqliteSchema.sessionMessages.retainedPayload, 1)
            )
          )
          .orderBy(
            asc(sqliteSchema.sessionMessages.timestamp),
            asc(sqliteSchema.sessionMessages.seq)
          )
          .limit(batchSize)
          .all();

        if (rows.length === 0) {
          return { compacted: 0 };
        }

        const seqList = rows.map((row) => row.seq);
        db.update(sqliteSchema.sessionMessages)
          .set({
            content: "",
            contentBlocksJson: null,
            toolCallsJson: null,
            reasoning: null,
            reasoningBlocksJson: null,
            partsJson: null,
            storageTier: "cold_stub",
            retainedPayload: 0,
            compactedAt: this.clock.nowMs(),
          })
          .where(inArray(sqliteSchema.sessionMessages.seq, seqList))
          .run();
        return { compacted: rows.length };
      },
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
