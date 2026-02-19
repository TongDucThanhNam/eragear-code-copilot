import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { ZodType } from "zod";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { toError } from "@/shared/utils/error.util";
import { stringifyJson } from "@/shared/utils/json.util";
import { migrateLegacyJsonIfNeeded } from "./sqlite-legacy-migration";
import {
  acquireSqliteProcessInitLock,
  SqliteProcessInitLockTimeoutError,
} from "./sqlite-process-lock";
import {
  callSqliteWorker,
  getSqliteWorkerStats,
  isSqliteWorkerEnabled,
} from "./sqlite-worker-client";
import { isSqliteWorkerThread } from "./sqlite-worker-flags";
import {
  enqueueSqliteWrite,
  flushSqliteWriteQueue,
  getSqliteWriteQueueStats,
} from "./sqlite-write-queue";
import {
  getStorageDirPath,
  getStoragePathResolutionInfo,
} from "./storage-path";

const SQLITE_FILE_NAME = "eragear.sqlite";
const SQLITE_WAL_FILE_SUFFIX = "-wal";
const SCHEMA_VERSION = 2;
const JSON_MIGRATION_MARKER_KEY = "json_migrated";
const SCHEMA_VERSION_MARKER_KEY = "schema_version";
const STORAGE_BACKEND_META_KEY = "storage_backend";
const STORAGE_PATH_ORIGIN_META_KEY = "storage_path_origin";
const SQLITE_SAVEPOINT_PREFIX = "sqlite_tx_";
const SQLITE_AUTO_VACUUM_INCREMENTAL = 2;
const SQLITE_NUMERIC_PRAGMAS = [
  "foreign_keys",
  "auto_vacuum",
  "freelist_count",
] as const;
const SOURCE_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../drizzle", import.meta.url)
);

const logger = createLogger("Storage");

export const SQLITE_SETTING_KEYS = {
  activeProjectId: "active_project_id",
  activeAgentId: "active_agent_id",
  agentDefaultsSeededV1: "agent_defaults_seeded_v1",
  uiSettings: "ui_settings",
  projectRoots: "project_roots",
  mcpServers: "mcp_servers",
  appConfig: "app_config",
} as const;

interface SqliteInitFailureState {
  error: Error;
  nextRetryAt: number;
  failureCount: number;
}

interface SqliteJsonContext {
  table: string;
  column: string;
}

type TransactionOperation = "savepoint" | "immediate";
type SqliteNumericPragma = (typeof SQLITE_NUMERIC_PRAGMAS)[number];

let sqliteDb: Database | null = null;
let sqliteInitPromise: Promise<Database> | null = null;
let sqliteInitFailureState: SqliteInitFailureState | null = null;
let sqliteLastCheckpointAt = 0;

export interface SqliteStorageStatsSnapshot {
  dbSizeBytes: number;
  walSizeBytes: number;
  freePages: number;
  sessionCount: number;
  messageCount: number;
  writeQueueDepth: number;
  pendingWriteQueueTotal?: number;
  pendingWriteQueueHigh?: number;
  pendingWriteQueueLow?: number;
  writeQueueFailures?: number;
  workerRecycleCount?: number;
  workerTimeoutCount?: number;
  workerLastRecycleReason?: string | null;
  workerLastRecycleAt?: number | null;
}

export interface SqliteRuntimeMaintenanceResult {
  checkpointRan: boolean;
  checkpointBusy: number;
  checkpointLogFrames: number;
  checkpointedFrames: number;
  freePages: number;
  pagesToVacuum: number;
}

export class StorageTransactionError extends Error {
  readonly operation: TransactionOperation;

  constructor(
    operation: TransactionOperation,
    message: string,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StorageTransactionError";
    this.operation = operation;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeBooleanToInt(value?: boolean): number | null {
  if (value === undefined) {
    return null;
  }
  return value ? 1 : 0;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return stringifyJson(value);
}

function setMeta(db: Database, key: string, value: string): void {
  db.query(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

function createSavepointName(): string {
  return `${SQLITE_SAVEPOINT_PREFIX}${randomUUID().replaceAll("-", "")}`;
}

export function runInSqliteTransaction<T>(db: Database, fn: () => T): T {
  const savepointName = createSavepointName();
  db.exec(`SAVEPOINT ${savepointName}`);
  try {
    const result = fn();
    db.exec(`RELEASE SAVEPOINT ${savepointName}`);
    return result;
  } catch (error) {
    const originalError = toError(error, "SQLite savepoint transaction failed");
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    } catch (rollbackFailure) {
      const rollbackError = toError(
        rollbackFailure,
        "SQLite savepoint rollback failed"
      );
      throw new StorageTransactionError(
        "savepoint",
        "SQLite savepoint transaction failed during rollback; connection state may be inconsistent",
        new AggregateError(
          [originalError, rollbackError],
          "SQLite savepoint rollback failed"
        )
      );
    }

    try {
      db.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } catch (releaseFailure) {
      throw new StorageTransactionError(
        "savepoint",
        "SQLite savepoint transaction failed during release",
        new AggregateError(
          [
            originalError,
            toError(releaseFailure, "SQLite savepoint release failed"),
          ],
          "SQLite savepoint release failed"
        )
      );
    }

    throw new StorageTransactionError(
      "savepoint",
      "SQLite savepoint transaction failed",
      originalError
    );
  }
}

function runInSqliteImmediateTransaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    const originalError = toError(error, "SQLite immediate transaction failed");
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new StorageTransactionError(
        "immediate",
        "SQLite immediate transaction failed during rollback",
        new AggregateError(
          [
            originalError,
            toError(
              rollbackError,
              "SQLite immediate transaction rollback failed"
            ),
          ],
          "SQLite immediate transaction rollback failed"
        )
      );
    }
    throw new StorageTransactionError(
      "immediate",
      "SQLite immediate transaction failed",
      originalError
    );
  }
}

function configureSqliteConnection(db: Database): void {
  const busyTimeoutMs = Math.max(1, Math.trunc(ENV.sqliteBusyTimeoutMs));
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  db.exec("PRAGMA foreign_keys = ON");

  const foreignKeysRow = db.query("PRAGMA foreign_keys").get() as {
    foreign_keys?: number;
  } | null;
  if (Number(foreignKeysRow?.foreign_keys ?? 0) !== 1) {
    throw new Error(
      "[Storage] Failed to enable SQLite foreign_keys pragma for active connection"
    );
  }

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
}

function readPragmaNumber(
  db: Database,
  pragmaName: SqliteNumericPragma
): number {
  const row = db.query(`PRAGMA ${pragmaName}`).get() as Record<
    string,
    unknown
  > | null;
  if (!row) {
    return 0;
  }
  const value = Object.values(row)[0];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function runWalCheckpoint(db: Database): {
  busy: number;
  logFrames: number;
  checkpointedFrames: number;
} {
  const row = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as Record<
    string,
    unknown
  > | null;

  if (!row) {
    return {
      busy: 0,
      logFrames: 0,
      checkpointedFrames: 0,
    };
  }

  const values = Object.values(row).map((value) => Number(value));
  const busy = values[0] ?? 0;
  const logFrames = values[1] ?? 0;
  const checkpointedFrames = values[2] ?? 0;
  return {
    busy: Number.isFinite(busy) ? busy : 0,
    logFrames: Number.isFinite(logFrames) ? logFrames : 0,
    checkpointedFrames: Number.isFinite(checkpointedFrames)
      ? checkpointedFrames
      : 0,
  };
}

function ensureIncrementalAutoVacuum(db: Database): void {
  const currentMode = readPragmaNumber(db, "auto_vacuum");
  if (currentMode === SQLITE_AUTO_VACUUM_INCREMENTAL) {
    return;
  }

  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");

  const nextMode = readPragmaNumber(db, "auto_vacuum");
  if (nextMode !== SQLITE_AUTO_VACUUM_INCREMENTAL) {
    throw new Error(
      "[Storage] Failed to enforce SQLite auto_vacuum=INCREMENTAL"
    );
  }

  logger.info("Enabled SQLite incremental auto_vacuum mode");
}

function maybeRunIncrementalVacuum(db: Database): {
  freePages: number;
  pagesToVacuum: number;
} {
  const freePages = readPragmaNumber(db, "freelist_count");
  if (freePages < ENV.sqliteIncrementalVacuumMinFreePages) {
    return { freePages, pagesToVacuum: 0 };
  }

  const pagesToVacuum = Math.max(
    0,
    Math.trunc(Math.min(freePages, ENV.sqliteIncrementalVacuumStepPages))
  );
  if (pagesToVacuum === 0) {
    return { freePages, pagesToVacuum: 0 };
  }
  db.exec(`PRAGMA incremental_vacuum(${pagesToVacuum})`);

  logger.info("Ran SQLite incremental vacuum maintenance", {
    freePages,
    pagesToVacuum,
  });
  return { freePages, pagesToVacuum };
}

function removeOrphanedSessionMessages(db: Database): void {
  const result = db
    .query(
      "DELETE FROM session_messages WHERE session_id NOT IN (SELECT id FROM sessions)"
    )
    .run() as { changes?: number };
  const orphanCount = Number(result?.changes ?? 0);
  if (orphanCount <= 0) {
    return;
  }

  logger.warn("Removed orphaned session message rows", {
    orphanCount,
  });
}

export function setSqliteSetting(db: Database, key: string, value: unknown) {
  db.query(
    "INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json"
  ).run(key, stringifyJson(value));
}

async function resolveMigrationsFolder(): Promise<string> {
  const configuredMigrationsDir = ENV.sqliteMigrationsDir;
  const trustedRoots = [
    path.resolve(process.cwd()),
    path.resolve(path.dirname(process.execPath)),
    path.resolve(SOURCE_MIGRATIONS_DIR),
  ];
  const isWithinTrustedRoots = (candidatePath: string): boolean => {
    const normalizedCandidate = path.resolve(candidatePath);
    return trustedRoots.some((root) => {
      const relative = path.relative(root, normalizedCandidate);
      return (
        relative === "" ||
        !(relative.startsWith("..") || path.isAbsolute(relative))
      );
    });
  };

  if (
    configuredMigrationsDir &&
    !isWithinTrustedRoots(configuredMigrationsDir)
  ) {
    throw new Error(
      `[Storage] STORAGE_MIGRATIONS_DIR must resolve inside trusted roots (${trustedRoots.join(", ")}), received: ${configuredMigrationsDir}`
    );
  }

  const candidates = [
    configuredMigrationsDir,
    path.join(process.cwd(), "drizzle"),
    path.join(path.dirname(process.execPath), "drizzle"),
    SOURCE_MIGRATIONS_DIR,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const dedupedCandidates = [
    ...new Set(candidates.map((candidate) => path.resolve(candidate))),
  ];

  for (const candidate of dedupedCandidates) {
    const journalPath = path.join(candidate, "meta", "_journal.json");
    if (await pathExists(journalPath)) {
      return candidate;
    }
  }

  throw new Error(
    `[Storage] Drizzle migrations folder not found. Expected \`meta/_journal.json\` under one of: ${dedupedCandidates.join(
      ", "
    )}`
  );
}

async function ensureSqliteSchema(db: Database): Promise<void> {
  const migrationsFolder = await resolveMigrationsFolder();
  const orm = drizzle({ client: db });
  migrate(orm, { migrationsFolder });

  setMeta(db, SCHEMA_VERSION_MARKER_KEY, String(SCHEMA_VERSION));
}

function persistStorageResolutionMeta(db: Database): void {
  setMeta(db, STORAGE_BACKEND_META_KEY, "sqlite_local");

  const resolution = getStoragePathResolutionInfo();
  if (!resolution) {
    return;
  }

  setMeta(db, STORAGE_PATH_ORIGIN_META_KEY, resolution.origin);
}

async function initializeSqliteDb(): Promise<Database> {
  const storageDir = await getStorageDirPath();
  await mkdir(storageDir, { recursive: true });
  let initLock: Awaited<
    ReturnType<typeof acquireSqliteProcessInitLock>
  > | null = null;
  try {
    initLock = await acquireSqliteProcessInitLock(storageDir);
  } catch (error) {
    if (error instanceof SqliteProcessInitLockTimeoutError) {
      logger.warn("SQLite init lock acquisition timed out", {
        lockPath: error.lockPath,
        attempts: error.attempts,
        timeoutMs: error.timeoutMs,
      });
    }
    throw error;
  }

  const dbPath = path.join(storageDir, SQLITE_FILE_NAME);
  let db: Database | null = null;
  try {
    db = new Database(dbPath);
    configureSqliteConnection(db);
    await ensureSqliteSchema(db);
    persistStorageResolutionMeta(db);
    await migrateLegacyJsonIfNeeded({
      db,
      storageDir,
      jsonMigrationMarkerKey: JSON_MIGRATION_MARKER_KEY,
      settingKeys: SQLITE_SETTING_KEYS,
      runInImmediateTransaction: runInSqliteImmediateTransaction,
    });
    removeOrphanedSessionMessages(db);
    ensureIncrementalAutoVacuum(db);
    maybeRunIncrementalVacuum(db);
    return db;
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors during failed initialization.
      }
    }
    throw error;
  } finally {
    initLock?.release();
  }
}

function buildSqliteInitCooldownError(
  state: SqliteInitFailureState,
  now: number
): Error {
  const remainingMs = Math.max(0, state.nextRetryAt - now);
  return new Error(
    `[Storage] SQLite initialization is in cooldown for ${remainingMs}ms after a previous failure`,
    {
      cause: state.error,
    }
  );
}

export async function getSqliteDb(): Promise<Database> {
  if (sqliteDb) {
    return sqliteDb;
  }

  const now = Date.now();
  if (sqliteInitFailureState && now < sqliteInitFailureState.nextRetryAt) {
    throw buildSqliteInitCooldownError(sqliteInitFailureState, now);
  }

  if (sqliteInitPromise) {
    return sqliteInitPromise;
  }

  sqliteInitPromise = initializeSqliteDb();
  try {
    sqliteDb = await sqliteInitPromise;
    sqliteInitFailureState = null;
    return sqliteDb;
  } catch (error) {
    const failure = toError(error, "Failed to initialize SQLite database");
    const failureCount = (sqliteInitFailureState?.failureCount ?? 0) + 1;
    sqliteInitFailureState = {
      error: failure,
      nextRetryAt: Date.now() + ENV.sqliteInitRetryCooldownMs,
      failureCount,
    };

    logger.error("SQLite initialization failed", failure, {
      failureCount,
      retryCooldownMs: ENV.sqliteInitRetryCooldownMs,
      nextRetryAt: sqliteInitFailureState.nextRetryAt,
    });

    throw failure;
  } finally {
    sqliteInitPromise = null;
  }
}

export async function closeSqliteDb(): Promise<void> {
  const flushed = await flushSqliteWriteQueue(10_000);
  if (!flushed) {
    const queueStats = getSqliteWriteQueueStats();
    logger.warn("SQLite write queue did not fully flush before close", {
      pending: queueStats.pending,
      pendingHigh: queueStats.pendingHigh,
      pendingLow: queueStats.pendingLow,
    });
  }

  const pendingInit = sqliteInitPromise;
  sqliteInitPromise = null;

  let dbToClose = sqliteDb;
  if (!dbToClose && pendingInit) {
    try {
      dbToClose = await pendingInit;
    } catch {
      sqliteInitFailureState = null;
      return;
    }
  }

  if (!dbToClose) {
    sqliteInitFailureState = null;
    return;
  }

  try {
    dbToClose.close();
  } finally {
    sqliteDb = null;
    sqliteInitFailureState = null;
    sqliteLastCheckpointAt = 0;
  }
}

async function readOptionalFileSize(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

export async function getSqliteStorageStatsLocal(): Promise<SqliteStorageStatsSnapshot> {
  const db = await getSqliteDb();
  const storageDir = await getStorageDirPath();
  const dbPath = path.join(storageDir, SQLITE_FILE_NAME);
  const walPath = `${dbPath}${SQLITE_WAL_FILE_SUFFIX}`;

  const freePages = readPragmaNumber(db, "freelist_count");
  const sessionsCountRow = db
    .query("SELECT value FROM app_meta WHERE key = 'sessions_count'")
    .get() as { value?: string } | null;
  const fallbackSessionCountRow = db
    .query("SELECT COUNT(*) AS count FROM sessions")
    .get() as { count?: number } | null;
  const messageCountRow = db
    .query("SELECT COALESCE(SUM(message_count), 0) AS total FROM sessions")
    .get() as { total?: number } | null;

  const sessionCount = Number.parseInt(sessionsCountRow?.value ?? "", 10);
  const normalizedSessionCount = Number.isFinite(sessionCount)
    ? Math.max(0, sessionCount)
    : Math.max(0, Number(fallbackSessionCountRow?.count ?? 0));
  const queueStats = getSqliteWriteQueueStats();
  const workerStats = getSqliteWorkerStats();

  return {
    dbSizeBytes: await readOptionalFileSize(dbPath),
    walSizeBytes: await readOptionalFileSize(walPath),
    freePages,
    sessionCount: normalizedSessionCount,
    messageCount: Math.max(0, Number(messageCountRow?.total ?? 0)),
    writeQueueDepth: queueStats.pending,
    pendingWriteQueueTotal: queueStats.pendingTotal,
    pendingWriteQueueHigh: queueStats.pendingHigh,
    pendingWriteQueueLow: queueStats.pendingLow,
    writeQueueFailures: queueStats.totalFailed,
    workerRecycleCount: workerStats.recycleCount,
    workerTimeoutCount: workerStats.timeoutCount,
    workerLastRecycleReason: workerStats.lastRecycleReason,
    workerLastRecycleAt: workerStats.lastRecycleAt,
  };
}

export function getSqliteStorageStats(): Promise<SqliteStorageStatsSnapshot> {
  if (isSqliteWorkerEnabled() && !isSqliteWorkerThread()) {
    return callSqliteWorker<SqliteStorageStatsSnapshot>(
      "storage",
      "getStorageStats",
      []
    ).then((stats) => {
      const workerStats = getSqliteWorkerStats();
      return {
        ...stats,
        workerRecycleCount: workerStats.recycleCount,
        workerTimeoutCount: workerStats.timeoutCount,
        workerLastRecycleReason: workerStats.lastRecycleReason,
        workerLastRecycleAt: workerStats.lastRecycleAt,
      };
    });
  }
  return getSqliteStorageStatsLocal();
}

export function runSqliteRuntimeMaintenanceLocal(): Promise<SqliteRuntimeMaintenanceResult> {
  return enqueueSqliteWrite(
    "sqlite.runtime_maintenance",
    async () => {
      const db = await getSqliteDb();
      const now = Date.now();
      let checkpointRan = false;
      let checkpointBusy = 0;
      let checkpointLogFrames = 0;
      let checkpointedFrames = 0;

      if (
        sqliteLastCheckpointAt === 0 ||
        now - sqliteLastCheckpointAt >= ENV.sqliteWalCheckpointIntervalMs
      ) {
        const checkpointResult = runWalCheckpoint(db);
        checkpointRan = true;
        checkpointBusy = checkpointResult.busy;
        checkpointLogFrames = checkpointResult.logFrames;
        checkpointedFrames = checkpointResult.checkpointedFrames;
        sqliteLastCheckpointAt = now;
      }

      const vacuumResult = maybeRunIncrementalVacuum(db);

      return {
        checkpointRan,
        checkpointBusy,
        checkpointLogFrames,
        checkpointedFrames,
        freePages: vacuumResult.freePages,
        pagesToVacuum: vacuumResult.pagesToVacuum,
      };
    },
    { priority: "low" }
  );
}

export function runSqliteRuntimeMaintenance(): Promise<SqliteRuntimeMaintenanceResult> {
  if (isSqliteWorkerEnabled() && !isSqliteWorkerThread()) {
    return callSqliteWorker("storage", "runMaintenance", []);
  }
  return runSqliteRuntimeMaintenanceLocal();
}

export function fromSqliteBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return Number(value) === 1;
}

export function toSqliteBoolean(value: boolean | undefined): number | null {
  return normalizeBooleanToInt(value);
}

export function fromSqliteJsonWithSchema<T>(
  raw: unknown,
  fallback: T,
  schema: ZodType<T>,
  context?: SqliteJsonContext
): T {
  if (typeof raw !== "string") {
    return fallback;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    if (context) {
      logger.warn("Invalid JSON in SQLite column; using fallback value", {
        table: context.table,
        column: context.column,
      });
    }
    return fallback;
  }

  const parsed = schema.safeParse(decoded);
  if (parsed.success) {
    return parsed.data;
  }

  if (context) {
    logger.warn("SQLite JSON failed schema validation; using fallback value", {
      table: context.table,
      column: context.column,
      issues: parsed.error.issues.slice(0, 3).map((issue) => ({
        path: issue.path.join(".") || "<root>",
        message: issue.message,
      })),
    });
  }

  return fallback;
}

export function toSqliteJson(raw: unknown): string | null {
  return toJson(raw);
}
