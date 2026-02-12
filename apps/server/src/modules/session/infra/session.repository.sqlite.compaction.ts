import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { ENV } from "@/config/environment";
import type { getSqliteOrm } from "@/platform/storage/sqlite-db";
import { sqliteSchema } from "@/platform/storage/sqlite-db";
import type { ClockPort } from "@/shared/ports/clock.port";

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const normalizedChunkSize = Math.max(1, Math.trunc(chunkSize));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    chunks.push(items.slice(index, index + normalizedChunkSize));
  }
  return chunks;
}

export function compactSessionMessagesInSqlite(params: {
  db: Awaited<ReturnType<typeof getSqliteOrm>>;
  sessionIds: string[];
  cutoffTimestamp: number;
  batchSize: number;
  clock: ClockPort;
}): Promise<{ compacted: number }> {
  const { db, sessionIds, cutoffTimestamp, batchSize, clock } = params;
  if (sessionIds.length === 0) {
    return Promise.resolve({ compacted: 0 });
  }
  const sqliteMaxBindParams = Math.max(1, Math.trunc(ENV.sqliteMaxBindParams));
  const sessionIdChunkSize = Math.max(1, sqliteMaxBindParams - 2);
  const selectedRows: Array<{ seq: number; timestamp: number }> = [];

  for (const sessionIdChunk of chunkArray(sessionIds, sessionIdChunkSize)) {
    if (selectedRows.length >= batchSize) {
      break;
    }
    const remaining = batchSize - selectedRows.length;
    const rows = db
      .select({
        seq: sqliteSchema.sessionMessages.seq,
        timestamp: sqliteSchema.sessionMessages.timestamp,
      })
      .from(sqliteSchema.sessionMessages)
      .where(
        and(
          inArray(sqliteSchema.sessionMessages.sessionId, sessionIdChunk),
          lte(sqliteSchema.sessionMessages.timestamp, cutoffTimestamp),
          eq(sqliteSchema.sessionMessages.retainedPayload, 1)
        )
      )
      .orderBy(
        asc(sqliteSchema.sessionMessages.timestamp),
        asc(sqliteSchema.sessionMessages.seq)
      )
      .limit(remaining)
      .all();
    selectedRows.push(...rows);
  }

  if (selectedRows.length === 0) {
    return Promise.resolve({ compacted: 0 });
  }

  selectedRows.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return left.seq - right.seq;
  });
  const seqList = selectedRows.slice(0, batchSize).map((row) => row.seq);
  const compactedAt = clock.nowMs();
  for (const seqChunk of chunkArray(seqList, sqliteMaxBindParams)) {
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
        compactedAt,
      })
      .where(inArray(sqliteSchema.sessionMessages.seq, seqChunk))
      .run();
  }

  return Promise.resolve({ compacted: seqList.length });
}
