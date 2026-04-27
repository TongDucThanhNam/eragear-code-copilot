import type { SQL } from "drizzle-orm";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { StoredSession } from "@/modules/session/domain/stored-session.types";
import type { getSqliteOrm } from "@/platform/storage/sqlite-db";
import { sqliteSchema } from "@/platform/storage/sqlite-db";
import { ValidationError } from "@/shared/errors";
import type {
  SessionListPageQuery,
  SessionListPageResult,
  SessionListQuery,
} from "../application/ports/session-repository.port";
import type { SessionSqliteMapper } from "./session-sqlite.mapper";

const SQLITE_SESSION_PAGE_OP = "session.page";

interface SessionListCursor {
  lastActiveAt: number;
  id: string;
}

interface SessionListPolicy {
  sessionListPageMaxLimit: number;
}

type SqliteOrm = Awaited<ReturnType<typeof getSqliteOrm>>;

function encodeSessionListCursor(cursor: SessionListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSessionListCursor(
  raw: string | undefined
): SessionListCursor | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as Partial<SessionListCursor>;
    const lastActiveAt = Number(decoded.lastActiveAt);
    const id = typeof decoded.id === "string" ? decoded.id : "";
    if (!(Number.isFinite(lastActiveAt) && id)) {
      return undefined;
    }
    return { lastActiveAt, id };
  } catch {
    return undefined;
  }
}

function createSessionListSelect(db: SqliteOrm) {
  return db
    .select({
      id: sqliteSchema.sessions.id,
      userId: sqliteSchema.sessions.userId,
      agentId: sqliteSchema.sessions.agentId,
      agentName: sqliteSchema.agents.name,
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
      supervisorJson: sqliteSchema.sessions.supervisorJson,
    })
    .from(sqliteSchema.sessions)
    .leftJoin(
      sqliteSchema.agents,
      eq(sqliteSchema.sessions.agentId, sqliteSchema.agents.id)
    )
    .orderBy(
      desc(sqliteSchema.sessions.lastActiveAt),
      desc(sqliteSchema.sessions.id)
    )
    .$dynamic();
}

export function listSessionsFromSqlite(params: {
  db: SqliteOrm;
  mapper: SessionSqliteMapper;
  policy: SessionListPolicy;
  query?: SessionListQuery;
  whereClause?: SQL<unknown>;
}): Promise<StoredSession[]> {
  const { db, mapper, policy, query, whereClause } = params;
  const offset = Math.max(0, Math.trunc(query?.offset ?? 0));
  const rawLimit = query?.limit;
  const limit =
    rawLimit === undefined
      ? undefined
      : Math.max(
          1,
          Math.min(policy.sessionListPageMaxLimit, Math.trunc(rawLimit))
        );

  let select = createSessionListSelect(db);
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
  return Promise.resolve(rows.map((row) => mapper.mapSessionListRow(row)));
}

export function listSessionsByCursorFromSqlite(params: {
  db: SqliteOrm;
  mapper: SessionSqliteMapper;
  policy: SessionListPolicy;
  query?: SessionListPageQuery;
  whereClause?: SQL<unknown>;
}): Promise<SessionListPageResult> {
  const { db, mapper, policy, query, whereClause } = params;
  const rawLimit = query?.limit;
  const limit =
    rawLimit === undefined
      ? policy.sessionListPageMaxLimit
      : Math.max(
          1,
          Math.min(policy.sessionListPageMaxLimit, Math.trunc(rawLimit))
        );
  const cursor = decodeSessionListCursor(query?.cursor);
  if (query?.cursor && !cursor) {
    throw new ValidationError("Invalid session list cursor", {
      module: "session",
      op: SQLITE_SESSION_PAGE_OP,
    });
  }

  const cursorClause = cursor
    ? or(
        lt(sqliteSchema.sessions.lastActiveAt, cursor.lastActiveAt),
        and(
          eq(sqliteSchema.sessions.lastActiveAt, cursor.lastActiveAt),
          lt(sqliteSchema.sessions.id, cursor.id)
        )
      )
    : undefined;

  let combinedWhere = whereClause;
  if (cursorClause) {
    combinedWhere = combinedWhere
      ? and(combinedWhere, cursorClause)
      : cursorClause;
  }

  let select = createSessionListSelect(db);
  if (combinedWhere) {
    select = select.where(combinedWhere);
  }

  const rows = select.limit(limit + 1).all();
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursorRow = pageRows.at(-1);
  const nextCursor =
    hasMore && nextCursorRow
      ? encodeSessionListCursor({
          lastActiveAt: Number(nextCursorRow.lastActiveAt),
          id: nextCursorRow.id,
        })
      : undefined;

  return Promise.resolve({
    sessions: pageRows.map((row) => mapper.mapSessionListRow(row)),
    nextCursor,
    hasMore,
  });
}
