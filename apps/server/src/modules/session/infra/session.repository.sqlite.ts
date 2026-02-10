/**
 * Session Repository (SQLite-backed via Drizzle ORM)
 */

import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getSqliteOrm, sqliteSchema } from "@/platform/storage/sqlite-db";
import {
  getSqliteDb,
  getSqliteStorageStats,
  runInSqliteTransaction,
} from "@/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "@/platform/storage/sqlite-write-queue";
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

const MAX_SESSION_PAGE_LIMIT = 500;
const MAX_MESSAGE_PAGE_LIMIT = 200;
const MAX_MESSAGE_DELETE_CHUNK_SIZE = 200;

export class SessionSqliteRepository
  extends SessionSqliteMapper
  implements SessionRepositoryPort
{
  async findById(id: string, userId: string): Promise<StoredSession | undefined> {
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
    return this.mapSessionRow(row);
  }

  async findAll(userId: string, query?: SessionListQuery): Promise<StoredSession[]> {
    const db = await getSqliteOrm();
    const offset = Math.max(0, Math.trunc(query?.offset ?? 0));
    const rawLimit = query?.limit;
    const limit =
      rawLimit === undefined
        ? undefined
        : Math.max(1, Math.min(MAX_SESSION_PAGE_LIMIT, Math.trunc(rawLimit)));

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
      .where(eq(sqliteSchema.sessions.userId, userId))
      .orderBy(desc(sqliteSchema.sessions.lastActiveAt))
      .$dynamic();

    if (limit !== undefined) {
      select = select.limit(limit);
    }
    if (offset > 0) {
      select = select.offset(offset);
    }

    const rows = select.all();
    return rows.map((row) => this.mapSessionListRow(row));
  }

  async findAllForMaintenance(
    query?: SessionListQuery
  ): Promise<StoredSession[]> {
    const db = await getSqliteOrm();
    const offset = Math.max(0, Math.trunc(query?.offset ?? 0));
    const rawLimit = query?.limit;
    const limit =
      rawLimit === undefined
        ? undefined
        : Math.max(1, Math.min(MAX_SESSION_PAGE_LIMIT, Math.trunc(rawLimit)));

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

    if (limit !== undefined) {
      select = select.limit(limit);
    }
    if (offset > 0) {
      select = select.offset(offset);
    }

    const rows = select.all();
    return rows.map((row) => this.mapSessionListRow(row));
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
    await enqueueSqliteWrite("session.save", async () => {
      const orm = await getSqliteOrm();
      const sqliteDb = await getSqliteDb();

      runInSqliteTransaction(sqliteDb, () => {
        const existing = orm
          .select({ id: sqliteSchema.sessions.id })
          .from(sqliteSchema.sessions)
          .where(eq(sqliteSchema.sessions.id, session.id))
          .get();
        const hasExisting = Boolean(existing);

        orm
          .insert(sqliteSchema.sessions)
          .values(this.toSessionInsert(session))
          .onConflictDoUpdate({
            target: sqliteSchema.sessions.id,
            set: this.toSessionSaveUpdateSet(session),
          })
          .run();

        const dedupedMessageById = new Map<string, MessageInsert>();
        for (const message of session.messages) {
          dedupedMessageById.set(
            message.id,
            this.toMessageInsert(session.id, message)
          );
        }
        const dedupedMessages = [...dedupedMessageById.values()];

        if (dedupedMessages.length === 0) {
          if (hasExisting) {
            orm
              .delete(sqliteSchema.sessionMessages)
              .where(eq(sqliteSchema.sessionMessages.sessionId, session.id))
              .run();
          }
          return;
        }

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

        if (!hasExisting) {
          return;
        }

        const incomingMessageIds = new Set(
          dedupedMessages.map((message) => message.messageId)
        );
        const existingMessageIds = orm
          .select({ messageId: sqliteSchema.sessionMessages.messageId })
          .from(sqliteSchema.sessionMessages)
          .where(eq(sqliteSchema.sessionMessages.sessionId, session.id))
          .all()
          .map((message) => message.messageId);
        const staleMessageIds = existingMessageIds.filter(
          (messageId) => !incomingMessageIds.has(messageId)
        );

        for (
          let start = 0;
          start < staleMessageIds.length;
          start += MAX_MESSAGE_DELETE_CHUNK_SIZE
        ) {
          const chunk = staleMessageIds.slice(
            start,
            start + MAX_MESSAGE_DELETE_CHUNK_SIZE
          );
          orm
            .delete(sqliteSchema.sessionMessages)
            .where(
              and(
                eq(sqliteSchema.sessionMessages.sessionId, session.id),
                inArray(sqliteSchema.sessionMessages.messageId, chunk)
              )
            )
            .run();
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
    await enqueueSqliteWrite("session.update_status", async () => {
      const db = await getSqliteOrm();
      if (options?.touchLastActiveAt === true) {
        db.update(sqliteSchema.sessions)
          .set({ status, lastActiveAt: Date.now() })
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
    await enqueueSqliteWrite("session.update_metadata", async () => {
      const db = await getSqliteOrm();
      const setValues: Partial<SessionInsert> = {
        lastActiveAt: Date.now(),
      };
      Object.assign(setValues, this.toMetadataUpdateSet(updates));

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
    await enqueueSqliteWrite("session.delete", async () => {
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
  ): Promise<void> {
    await enqueueSqliteWrite("session.append_message", async () => {
      const orm = await getSqliteOrm();
      const sqliteDb = await getSqliteDb();

      runInSqliteTransaction(sqliteDb, () => {
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
          return;
        }

        const values = this.toMessageInsert(id, message);
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
            lastActiveAt: Date.now(),
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
        MAX_MESSAGE_PAGE_LIMIT,
        Math.trunc(query.limit ?? MAX_MESSAGE_PAGE_LIMIT)
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
      messages: pageRows.map((row) => this.mapMessageRow(row.session_messages)),
      nextCursor,
      hasMore,
    };
  }

  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }> {
    const cutoff = Math.max(0, Math.trunc(input.beforeTimestamp));
    const batchSize = Math.max(1, Math.min(500, Math.trunc(input.batchSize)));

    return enqueueSqliteWrite("session.compact_messages", async () => {
      const db = await getSqliteOrm();
      const rows = db
        .select({
          seq: sqliteSchema.sessionMessages.seq,
        })
        .from(sqliteSchema.sessionMessages)
        .innerJoin(
          sqliteSchema.sessions,
          eq(sqliteSchema.sessionMessages.sessionId, sqliteSchema.sessions.id)
        )
        .where(
          and(
            lte(sqliteSchema.sessionMessages.timestamp, cutoff),
            eq(sqliteSchema.sessionMessages.retainedPayload, 1),
            eq(sqliteSchema.sessions.status, "stopped")
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
          compactedAt: Date.now(),
        })
        .where(inArray(sqliteSchema.sessionMessages.seq, seqList))
        .run();
      return { compacted: rows.length };
    });
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
    };
  }
}
