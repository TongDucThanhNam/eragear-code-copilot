import { and, desc, eq, gte } from "drizzle-orm";
import {
  getSqliteOrm,
  sqliteSchema,
  withSqliteTransaction,
} from "#runtime/platform/storage/sqlite-db";
import {
  fromSqliteBoolean,
  toSqliteBoolean,
} from "#runtime/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "#runtime/platform/storage/sqlite-write-queue";
import {
  type UsageStatsRecord,
  UsageStatsRecordSchema,
  type UsageTelemetrySettings,
  UsageTelemetrySettingsSchema,
} from "../application/contracts/usage-stats.contract";
import type {
  MutableUsageTelemetrySettingsSnapshot,
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "../application/ports/usage-stats-repository.port";

const DEFAULT_MAX_RECORDS_PER_USER = 5000;
const SQLITE_USAGE_STATS_OP = {
  APPEND_RECORD: "usage_stats.append_record",
  SAVE_TELEMETRY: "usage_stats.save_telemetry",
} as const;

type SqliteOrm = Awaited<ReturnType<typeof getSqliteOrm>>;
type UsageStatsRecordRow = typeof sqliteSchema.usageStatsRecords.$inferSelect;
type MutableTelemetrySettingsSnapshot =
  MutableUsageTelemetrySettingsSnapshot & {
    getNext(): UsageTelemetrySettings | null;
    hasChanged(): boolean;
  };

interface UsageStatsSqliteRepositoryDeps {
  maxRecordsPerUser?: number;
  ormProvider?: () => Promise<SqliteOrm>;
}

export class UsageStatsSqliteRepository implements UsageStatsRepositoryPort {
  private readonly maxRecordsPerUser: number;
  private readonly ormProvider: () => Promise<SqliteOrm>;

  constructor(deps: UsageStatsSqliteRepositoryDeps = {}) {
    this.maxRecordsPerUser = Math.max(
      1,
      Math.trunc(deps.maxRecordsPerUser ?? DEFAULT_MAX_RECORDS_PER_USER)
    );
    this.ormProvider = deps.ormProvider ?? getSqliteOrm;
  }

  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord> {
    const parsedRecord = UsageStatsRecordSchema.parse(record);
    return enqueueSqliteWrite(SQLITE_USAGE_STATS_OP.APPEND_RECORD, async () => {
      await withSqliteTransaction(({ orm, db }) => {
        orm
          .insert(sqliteSchema.usageStatsRecords)
          .values({
            id: parsedRecord.id,
            userId: parsedRecord.userId,
            kind: parsedRecord.kind,
            projectId: parsedRecord.projectId ?? null,
            projectRoot: parsedRecord.projectRoot ?? null,
            chatId: parsedRecord.chatId ?? null,
            agentSessionId: parsedRecord.agentSessionId ?? null,
            turnId: parsedRecord.turnId ?? null,
            providerId: parsedRecord.providerId ?? null,
            providerDisplayName: parsedRecord.providerDisplayName ?? null,
            status: parsedRecord.status ?? null,
            inputTokens: parsedRecord.inputTokens ?? null,
            outputTokens: parsedRecord.outputTokens ?? null,
            createdAt: parsedRecord.createdAt,
          })
          .onConflictDoUpdate({
            target: sqliteSchema.usageStatsRecords.id,
            set: {
              userId: parsedRecord.userId,
              kind: parsedRecord.kind,
              projectId: parsedRecord.projectId ?? null,
              projectRoot: parsedRecord.projectRoot ?? null,
              chatId: parsedRecord.chatId ?? null,
              agentSessionId: parsedRecord.agentSessionId ?? null,
              turnId: parsedRecord.turnId ?? null,
              providerId: parsedRecord.providerId ?? null,
              providerDisplayName: parsedRecord.providerDisplayName ?? null,
              status: parsedRecord.status ?? null,
              inputTokens: parsedRecord.inputTokens ?? null,
              outputTokens: parsedRecord.outputTokens ?? null,
              createdAt: parsedRecord.createdAt,
            },
          })
          .run();

        db.query(
          `DELETE FROM usage_stats_records
           WHERE user_id = ?
             AND id NOT IN (
               SELECT id
               FROM usage_stats_records
               WHERE user_id = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?
             )`
        ).run(parsedRecord.userId, parsedRecord.userId, this.maxRecordsPerUser);
      });
      return parsedRecord;
    });
  }

  async listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]> {
    const db = await this.ormProvider();
    const conditions = [eq(sqliteSchema.usageStatsRecords.userId, userId)];
    if (input?.sinceMs !== undefined) {
      conditions.push(
        gte(sqliteSchema.usageStatsRecords.createdAt, input.sinceMs)
      );
    }
    const limit =
      input?.limit === undefined ? undefined : Math.max(0, input.limit);
    const query = db
      .select()
      .from(sqliteSchema.usageStatsRecords)
      .where(and(...conditions))
      .orderBy(desc(sqliteSchema.usageStatsRecords.createdAt));
    const rows =
      limit === undefined ? query.all() : query.limit(Math.trunc(limit)).all();
    return rows.map((row) => mapRecordRow(row));
  }

  async readTelemetrySettings<T>(
    userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const settings = await this.findTelemetrySettings(userId);
    return await reader(createTelemetrySettingsSnapshot(settings));
  }

  async mutateTelemetrySettings<T>(
    userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const current = await this.findTelemetrySettings(userId);
    const snapshot = createMutableTelemetrySettingsSnapshot(current);
    const result = await mutator(snapshot);
    if (snapshot.hasChanged()) {
      const next = snapshot.getNext();
      if (next) {
        await this.saveTelemetrySettingsForUser(userId, next);
      }
    }
    return result;
  }

  getTelemetrySettings(userId: string): Promise<UsageTelemetrySettings | null> {
    return this.findTelemetrySettings(userId);
  }

  async saveTelemetrySettings(
    userId: string,
    settings: UsageTelemetrySettings
  ): Promise<UsageTelemetrySettings> {
    const parsedSettings = UsageTelemetrySettingsSchema.parse(settings);
    await this.saveTelemetrySettingsForUser(userId, parsedSettings);
    return cloneTelemetrySettings(parsedSettings);
  }

  private async findTelemetrySettings(
    userId: string
  ): Promise<UsageTelemetrySettings | null> {
    const db = await this.ormProvider();
    const row = db
      .select()
      .from(sqliteSchema.usageTelemetrySettings)
      .where(eq(sqliteSchema.usageTelemetrySettings.userId, userId))
      .get();
    if (!row) {
      return null;
    }
    return {
      enabled: Boolean(fromSqliteBoolean(row.enabled)),
      updatedAt: row.updatedAt,
    };
  }

  private saveTelemetrySettingsForUser(
    userId: string,
    settings: UsageTelemetrySettings
  ): Promise<void> {
    return enqueueSqliteWrite(
      SQLITE_USAGE_STATS_OP.SAVE_TELEMETRY,
      async () => {
        const db = await this.ormProvider();
        db.insert(sqliteSchema.usageTelemetrySettings)
          .values({
            userId,
            enabled: toSqliteBoolean(settings.enabled) ?? 0,
            updatedAt: settings.updatedAt,
          })
          .onConflictDoUpdate({
            target: sqliteSchema.usageTelemetrySettings.userId,
            set: {
              enabled: toSqliteBoolean(settings.enabled) ?? 0,
              updatedAt: settings.updatedAt,
            },
          })
          .run();
      }
    );
  }
}

function createTelemetrySettingsSnapshot(
  settings: UsageTelemetrySettings | null
): UsageTelemetrySettingsSnapshot {
  return {
    get() {
      return settings ? cloneTelemetrySettings(settings) : null;
    },
  };
}

function createMutableTelemetrySettingsSnapshot(
  initial: UsageTelemetrySettings | null
): MutableTelemetrySettingsSnapshot {
  let changed = false;
  let next = initial ? cloneTelemetrySettings(initial) : null;
  return {
    get() {
      return next ? cloneTelemetrySettings(next) : null;
    },
    set(settings) {
      changed = true;
      next = cloneTelemetrySettings(settings);
    },
    getNext() {
      return next ? cloneTelemetrySettings(next) : null;
    },
    hasChanged() {
      return changed;
    },
  };
}

function cloneTelemetrySettings(
  settings: UsageTelemetrySettings
): UsageTelemetrySettings {
  return { ...settings };
}

function mapRecordRow(row: UsageStatsRecordRow): UsageStatsRecord {
  return UsageStatsRecordSchema.parse({
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.projectRoot ? { projectRoot: row.projectRoot } : {}),
    ...(row.chatId ? { chatId: row.chatId } : {}),
    ...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
    ...(row.turnId ? { turnId: row.turnId } : {}),
    ...(row.providerId ? { providerId: row.providerId } : {}),
    ...(row.providerDisplayName
      ? { providerDisplayName: row.providerDisplayName }
      : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : {}),
    ...(row.outputTokens !== null ? { outputTokens: row.outputTokens } : {}),
    createdAt: row.createdAt,
  });
}
