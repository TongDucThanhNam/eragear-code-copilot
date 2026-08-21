import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  UsageStatsCliSummary,
  UsageStatsRange,
} from "../application/contracts/usage-stats.contract";
import type { UsageStatsSnapshotCachePort } from "./cached-usage-stats-scanner.adapter";

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 16;
const VALID_RANGES = new Set<UsageStatsRange>(["24h", "7d", "30d", "all"]);

interface SnapshotRow {
  schema_version: number;
  saved_at_ms: number;
  payload: string;
}

export class UsageStatsSnapshotSqliteCache
  implements UsageStatsSnapshotCachePort
{
  private readonly filePath: () => string;
  private readonly maxEntries: number;
  private db?: Database;

  constructor(options: { filePath: () => string; maxEntries?: number }) {
    this.filePath = options.filePath;
    this.maxEntries = Math.max(
      1,
      Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES)
    );
  }

  read(key: string, minSavedAtMs: number): UsageStatsCliSummary | undefined {
    const row = this.database()
      .query(
        `SELECT schema_version, saved_at_ms, payload
         FROM usage_scan_snapshots
         WHERE cache_key = $key AND saved_at_ms >= $minSavedAtMs
         LIMIT 1`
      )
      .get({ $key: key, $minSavedAtMs: minSavedAtMs }) as SnapshotRow | null;
    if (!row || row.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return isUsageStatsCliSummary(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  write(key: string, result: UsageStatsCliSummary, savedAtMs: number): void {
    const db = this.database();
    db.query(
      `INSERT INTO usage_scan_snapshots (
         cache_key, schema_version, checked_at_ms, saved_at_ms, payload
       ) VALUES ($key, $schemaVersion, $checkedAtMs, $savedAtMs, $payload)
       ON CONFLICT(cache_key) DO UPDATE SET
         schema_version = excluded.schema_version,
         checked_at_ms = excluded.checked_at_ms,
         saved_at_ms = excluded.saved_at_ms,
         payload = excluded.payload`
    ).run({
      $key: key,
      $schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      $checkedAtMs: result.checkedAt,
      $savedAtMs: savedAtMs,
      $payload: JSON.stringify({ ...result, refreshing: false }),
    });

    const staleKeys = db
      .query(
        `SELECT cache_key
         FROM usage_scan_snapshots
         ORDER BY saved_at_ms DESC
         LIMIT -1 OFFSET $maxEntries`
      )
      .all({ $maxEntries: this.maxEntries }) as Array<{ cache_key: string }>;
    const deleteStatement = db.query(
      "DELETE FROM usage_scan_snapshots WHERE cache_key = $key"
    );
    for (const stale of staleKeys) {
      deleteStatement.run({ $key: stale.cache_key });
    }
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private database(): Database {
    if (this.db) {
      return this.db;
    }
    const filePath = this.filePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const db = new Database(filePath, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec("PRAGMA busy_timeout = 1000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_scan_snapshots (
        cache_key TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        checked_at_ms INTEGER NOT NULL,
        saved_at_ms INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_scan_snapshots_saved_at_idx
      ON usage_scan_snapshots(saved_at_ms DESC);
    `);
    this.db = db;
    return db;
  }
}

function isUsageStatsCliSummary(value: unknown): value is UsageStatsCliSummary {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<UsageStatsCliSummary>;
  return (
    typeof candidate.range === "string" &&
    VALID_RANGES.has(candidate.range as UsageStatsRange) &&
    typeof candidate.checkedAt === "number" &&
    Number.isFinite(candidate.checkedAt) &&
    Array.isArray(candidate.providers) &&
    Array.isArray(candidate.daily) &&
    Array.isArray(candidate.modelUsage) &&
    Array.isArray(candidate.warnings) &&
    !!candidate.totals &&
    typeof candidate.totals === "object" &&
    !!candidate.cost &&
    typeof candidate.cost === "object" &&
    !!candidate.pricing &&
    typeof candidate.pricing === "object"
  );
}
