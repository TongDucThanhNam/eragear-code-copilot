import { Database } from "bun:sqlite";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { ZodType } from "zod";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import type { AgentConfig } from "@/shared/types/agent.types";
import type { Project } from "@/shared/types/project.types";
import type { StoredSession } from "@/shared/types/session.types";
import type { Settings } from "@/shared/types/settings.types";
import { stringifyJson } from "@/shared/utils/json.util";
import {
  callSqliteWorker,
  getSqliteWorkerStats,
  isSqliteWorkerEnabled,
} from "./sqlite-worker-client";
import { isSqliteWorkerThread } from "./sqlite-worker-flags";
import {
  enqueueSqliteWrite,
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
const STORAGE_PATH_REJECTED_META_KEY = "storage_path_rejected";
const STORAGE_PATH_REASON_META_KEY = "storage_path_reason";
const SQLITE_SAVEPOINT_PREFIX = "sqlite_tx_";
const SQLITE_VARIABLE_LIMIT = 999;
const SQLITE_AUTO_VACUUM_INCREMENTAL = 2;
const SOURCE_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../drizzle", import.meta.url)
);
const LEGACY_JSON_FILES = [
  "projects.json",
  "sessions.json",
  "agents.json",
  "ui-settings.json",
] as const;

const PROJECT_IMPORT_CHUNK_SIZE = 80;
const AGENT_IMPORT_CHUNK_SIZE = 80;
const SESSION_IMPORT_CHUNK_SIZE = 25;
const MESSAGE_IMPORT_CHUNK_SIZE = 80;

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

interface LegacyProjectsData {
  projects?: Project[];
  activeProjectId?: string | null;
}

interface LegacyAgentsData {
  agents?: AgentConfig[];
  activeAgentId?: string | null;
}

interface SqliteInitFailureState {
  error: Error;
  nextRetryAt: number;
  failureCount: number;
}

interface SqliteJsonContext {
  table: string;
  column: string;
}

type SqlitePrimitive = string | number | null;
type TransactionOperation = "savepoint" | "immediate";

let sqliteDb: Database | null = null;
let sqliteInitPromise: Promise<Database> | null = null;
let sqliteInitFailureState: SqliteInitFailureState | null = null;
let sqliteSavepointCounter = 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(fallbackMessage, { cause: error });
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

function fromJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setMeta(db: Database, key: string, value: string): void {
  db.query(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

function getMeta(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM app_meta WHERE key = ?").get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}

function createSavepointName(): string {
  sqliteSavepointCounter += 1;
  return `${SQLITE_SAVEPOINT_PREFIX}${sqliteSavepointCounter}`;
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
    let rollbackError: Error | null = null;
    let releaseError: Error | null = null;

    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    } catch (rollbackFailure) {
      rollbackError = toError(
        rollbackFailure,
        "SQLite savepoint rollback failed"
      );
    }

    try {
      db.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } catch (releaseFailure) {
      releaseError = toError(releaseFailure, "SQLite savepoint release failed");
    }

    if (rollbackError || releaseError) {
      const recoveryErrors = [rollbackError, releaseError].filter(
        (entry): entry is Error => entry !== null
      );
      throw new StorageTransactionError(
        "savepoint",
        "SQLite savepoint transaction failed during rollback",
        new AggregateError(
          [originalError, ...recoveryErrors],
          "SQLite savepoint rollback failed"
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

async function runInSqliteImmediateTransaction<T>(
  db: Database,
  fn: () => Promise<T> | T
): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn();
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
  db.exec(`PRAGMA busy_timeout = ${ENV.sqliteBusyTimeoutMs}`);
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

function readPragmaNumber(db: Database, pragmaName: string): number {
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

  const pagesToVacuum = Math.min(
    freePages,
    ENV.sqliteIncrementalVacuumStepPages
  );
  db.exec(`PRAGMA incremental_vacuum(${pagesToVacuum})`);

  logger.info("Ran SQLite incremental vacuum maintenance", {
    freePages,
    pagesToVacuum,
  });
  return { freePages, pagesToVacuum };
}

function hasSqlData(db: Database): boolean {
  return (
    tableHasRows(db, "projects") ||
    tableHasRows(db, "sessions") ||
    tableHasRows(db, "agents")
  );
}

function tableHasRows(db: Database, tableName: string): boolean {
  const row = db
    .query(`SELECT 1 AS has_row FROM ${tableName} LIMIT 1`)
    .get() as { has_row: number } | null;
  return row !== null;
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

interface BulkInsertParams {
  db: Database;
  prefixSql: string;
  rows: SqlitePrimitive[][];
  columnCount: number;
  preferredChunkSize: number;
}

function runBulkInsert({
  db,
  prefixSql,
  rows,
  columnCount,
  preferredChunkSize,
}: BulkInsertParams): void {
  if (rows.length === 0) {
    return;
  }

  const maxChunkRows = Math.max(
    1,
    Math.floor(SQLITE_VARIABLE_LIMIT / columnCount)
  );
  const chunkSize = Math.max(1, Math.min(preferredChunkSize, maxChunkRows));

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk
      .map(() => `(${new Array(columnCount).fill("?").join(", ")})`)
      .join(", ");

    const values: SqlitePrimitive[] = [];
    for (const row of chunk) {
      if (row.length !== columnCount) {
        throw new Error(
          `[Storage] Bulk insert row has invalid shape: expected ${columnCount} columns, got ${row.length}`
        );
      }
      values.push(...row);
    }

    db.query(`${prefixSql} ${placeholders}`).run(...values);
  }
}

export function getSqliteSetting<T>(db: Database, key: string, fallback: T): T {
  const row = db
    .query("SELECT value_json FROM app_settings WHERE key = ?")
    .get(key) as { value_json: string } | null;
  if (!row) {
    return fallback;
  }
  return fromJson(row.value_json, fallback);
}

export function setSqliteSetting(db: Database, key: string, value: unknown) {
  db.query(
    "INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json"
  ).run(key, stringifyJson(value));
}

function setSqliteSettingIfMissing(
  db: Database,
  key: string,
  value: unknown
): void {
  db.query(
    "INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
  ).run(key, stringifyJson(value));
}

async function readLegacyJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      isRecord(error) &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw new Error(`Failed to parse legacy JSON file: ${filePath}`, {
      cause: error,
    });
  }
}

async function backupLegacyFiles(
  storageDir: string,
  filesToBackup: string[]
): Promise<void> {
  if (filesToBackup.length === 0) {
    return;
  }

  const backupDir = await mkdtemp(path.join(storageDir, "backup-"));
  await Promise.all(
    filesToBackup.map(async (filename) => {
      await copyFile(
        path.join(storageDir, filename),
        path.join(backupDir, filename)
      );
    })
  );
}

async function resolveMigrationsFolder(): Promise<string> {
  const configuredMigrationsDir = ENV.sqliteMigrationsDir;
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
  if (resolution.rejectedPath) {
    setMeta(db, STORAGE_PATH_REJECTED_META_KEY, resolution.rejectedPath);
  }
  if (resolution.reason) {
    setMeta(db, STORAGE_PATH_REASON_META_KEY, resolution.reason);
  }
}

function importLegacyProjects(db: Database, projects: Project[]): void {
  const rows: SqlitePrimitive[][] = projects.map((project) => [
    project.id,
    project.name,
    project.path,
    project.description ?? null,
    stringifyJson(project.tags ?? []),
    project.favorite ? 1 : 0,
    project.createdAt,
    project.updatedAt,
    project.lastOpenedAt ?? null,
  ]);

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO projects (
      id, name, path, description, tags_json, favorite, created_at, updated_at, last_opened_at
    ) VALUES`,
    rows,
    columnCount: 9,
    preferredChunkSize: PROJECT_IMPORT_CHUNK_SIZE,
  });
}

function importLegacyAgents(params: {
  db: Database;
  agents: AgentConfig[];
  projectIds: Set<string>;
}): void {
  const { db, agents, projectIds } = params;

  const rows: SqlitePrimitive[][] = agents.map((agent) => {
    const mappedProjectId =
      agent.projectId && projectIds.has(agent.projectId)
        ? agent.projectId
        : null;

    return [
      agent.id,
      agent.name,
      agent.type,
      agent.command,
      toJson(agent.args),
      toJson(agent.env),
      mappedProjectId,
      agent.createdAt,
      agent.updatedAt,
    ];
  });

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO agents (
      id, name, type, command, args_json, env_json, project_id, created_at, updated_at
    ) VALUES`,
    rows,
    columnCount: 9,
    preferredChunkSize: AGENT_IMPORT_CHUNK_SIZE,
  });
}

function resolveSessionProjectId(params: {
  session: StoredSession;
  projectIds: Set<string>;
  projectByPath: Map<string, string>;
}): string | null {
  const { session, projectIds, projectByPath } = params;
  if (session.projectId && projectIds.has(session.projectId)) {
    return session.projectId;
  }
  return projectByPath.get(session.projectRoot) ?? null;
}

function importLegacySessions(params: {
  db: Database;
  sessions: StoredSession[];
  projectIds: Set<string>;
  projectByPath: Map<string, string>;
}): void {
  const { db, sessions, projectIds, projectByPath } = params;

  const sessionRows: SqlitePrimitive[][] = [];
  const messageRows: SqlitePrimitive[][] = [];

  for (const session of sessions) {
    const mappedProjectId = resolveSessionProjectId({
      session,
      projectIds,
      projectByPath,
    });

    sessionRows.push([
      session.id,
      session.name ?? null,
      session.sessionId ?? null,
      mappedProjectId,
      session.projectRoot,
      session.command ?? null,
      toJson(session.args),
      toJson(session.env),
      session.cwd ?? null,
      normalizeBooleanToInt(session.loadSessionSupported),
      normalizeBooleanToInt(session.useUnstableResume),
      normalizeBooleanToInt(session.supportsModelSwitching),
      toJson(session.agentInfo),
      session.status === "running" ? "running" : "stopped",
      normalizeBooleanToInt(session.pinned),
      normalizeBooleanToInt(session.archived),
      session.createdAt,
      session.lastActiveAt,
      session.modeId ?? null,
      session.modelId ?? null,
      toJson(session.plan),
      toJson(session.commands),
      toJson(session.agentCapabilities),
      toJson(session.authMethods),
      0,
    ]);

    for (const message of session.messages ?? []) {
      messageRows.push([
        session.id,
        message.id,
        message.role === "assistant" ? "assistant" : "user",
        message.content,
        toJson(message.contentBlocks),
        message.timestamp,
        toJson(message.toolCalls),
        message.reasoning ?? null,
        toJson(message.reasoningBlocks),
        toJson(message.parts),
      ]);
    }
  }

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO sessions (
      id, name, session_id, project_id, project_root, command, args_json, env_json, cwd,
      load_session_supported, use_unstable_resume, supports_model_switching, agent_info_json,
      status, pinned, archived, created_at, last_active_at, mode_id, model_id, plan_json,
      commands_json, agent_capabilities_json, auth_methods_json, message_count
    ) VALUES`,
    rows: sessionRows,
    columnCount: 25,
    preferredChunkSize: SESSION_IMPORT_CHUNK_SIZE,
  });

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO session_messages (
      session_id, message_id, role, content, content_blocks_json, timestamp,
      tool_calls_json, reasoning, reasoning_blocks_json, parts_json
    ) VALUES`,
    rows: messageRows,
    columnCount: 10,
    preferredChunkSize: MESSAGE_IMPORT_CHUNK_SIZE,
  });

  db.exec(
    `UPDATE sessions
     SET message_count = (
       SELECT COUNT(*) FROM session_messages WHERE session_messages.session_id = sessions.id
     )`
  );
}

function importLegacySettings(params: {
  db: Database;
  activeProjectId: string | null;
  projectIds: Set<string>;
  activeAgentId: string | null;
  agents: AgentConfig[];
  settings: Settings | null;
}): void {
  const { db, activeProjectId, projectIds, activeAgentId, agents, settings } =
    params;

  if (activeProjectId && projectIds.has(activeProjectId)) {
    setSqliteSettingIfMissing(
      db,
      SQLITE_SETTING_KEYS.activeProjectId,
      activeProjectId
    );
  } else {
    setSqliteSettingIfMissing(db, SQLITE_SETTING_KEYS.activeProjectId, null);
  }

  const agentIds = new Set(agents.map((agent) => agent.id));
  if (activeAgentId && agentIds.has(activeAgentId)) {
    setSqliteSettingIfMissing(
      db,
      SQLITE_SETTING_KEYS.activeAgentId,
      activeAgentId
    );
  } else {
    setSqliteSettingIfMissing(db, SQLITE_SETTING_KEYS.activeAgentId, null);
  }

  if (!settings) {
    return;
  }

  setSqliteSettingIfMissing(db, SQLITE_SETTING_KEYS.uiSettings, settings.ui);
  setSqliteSettingIfMissing(
    db,
    SQLITE_SETTING_KEYS.projectRoots,
    settings.projectRoots ?? []
  );
  setSqliteSettingIfMissing(
    db,
    SQLITE_SETTING_KEYS.mcpServers,
    settings.mcpServers ?? []
  );
  setSqliteSettingIfMissing(
    db,
    SQLITE_SETTING_KEYS.appConfig,
    settings.app ?? null
  );
}

function importLegacyData(params: {
  db: Database;
  projects: Project[];
  activeProjectId: string | null;
  agents: AgentConfig[];
  activeAgentId: string | null;
  settings: Settings | null;
  sessions: StoredSession[];
}) {
  const { db, projects, activeProjectId, agents, activeAgentId, settings } =
    params;
  const sessions = params.sessions;
  const projectIds = new Set(projects.map((project) => project.id));
  const projectByPath = new Map(
    projects.map((project) => [project.path, project.id] as const)
  );

  importLegacyProjects(db, projects);
  importLegacyAgents({ db, agents, projectIds });
  importLegacySessions({ db, sessions, projectIds, projectByPath });
  importLegacySettings({
    db,
    activeProjectId,
    projectIds,
    activeAgentId,
    agents,
    settings,
  });
}

async function getExistingLegacyFiles(storageDir: string): Promise<string[]> {
  const existingLegacyFiles: string[] = [];
  for (const filename of LEGACY_JSON_FILES) {
    if (await pathExists(path.join(storageDir, filename))) {
      existingLegacyFiles.push(filename);
    }
  }
  return existingLegacyFiles;
}

async function loadLegacyData(storageDir: string): Promise<{
  projects: Project[];
  activeProjectId: string | null;
  sessions: StoredSession[];
  agents: AgentConfig[];
  activeAgentId: string | null;
  settings: Settings | null;
}> {
  const projectsData =
    (await readLegacyJsonFile<LegacyProjectsData>(
      path.join(storageDir, "projects.json")
    )) ?? {};
  const sessionsData =
    (await readLegacyJsonFile<StoredSession[]>(
      path.join(storageDir, "sessions.json")
    )) ?? [];
  const agentsData =
    (await readLegacyJsonFile<LegacyAgentsData>(
      path.join(storageDir, "agents.json")
    )) ?? {};
  const settingsData =
    (await readLegacyJsonFile<Settings>(
      path.join(storageDir, "ui-settings.json")
    )) ?? null;

  return {
    projects: Array.isArray(projectsData.projects) ? projectsData.projects : [],
    activeProjectId: projectsData.activeProjectId ?? null,
    sessions: Array.isArray(sessionsData) ? sessionsData : [],
    agents: Array.isArray(agentsData.agents) ? agentsData.agents : [],
    activeAgentId: agentsData.activeAgentId ?? null,
    settings: settingsData,
  };
}

async function maybeMigrateFromLegacyJson(
  db: Database,
  storageDir: string
): Promise<void> {
  await runInSqliteImmediateTransaction(db, async () => {
    if (getMeta(db, JSON_MIGRATION_MARKER_KEY) === "1") {
      return;
    }

    const existingLegacyFiles = await getExistingLegacyFiles(storageDir);
    if (existingLegacyFiles.length === 0) {
      setMeta(db, JSON_MIGRATION_MARKER_KEY, "1");
      return;
    }

    if (hasSqlData(db)) {
      logger.warn(
        "Legacy JSON migration marker is missing while SQLite already has data. Proceeding with idempotent migration."
      );
    }

    await backupLegacyFiles(storageDir, existingLegacyFiles);

    const legacyData = await loadLegacyData(storageDir);
    importLegacyData({ db, ...legacyData });

    setMeta(db, JSON_MIGRATION_MARKER_KEY, "1");
  });
}

async function initializeSqliteDb(): Promise<Database> {
  const storageDir = await getStorageDirPath();
  await mkdir(storageDir, { recursive: true });
  const dbPath = path.join(storageDir, SQLITE_FILE_NAME);
  const db = new Database(dbPath);
  try {
    configureSqliteConnection(db);
    await ensureSqliteSchema(db);
    persistStorageResolutionMeta(db);
    await maybeMigrateFromLegacyJson(db, storageDir);
    removeOrphanedSessionMessages(db);
    ensureIncrementalAutoVacuum(db);
    configureSqliteConnection(db);
    maybeRunIncrementalVacuum(db);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Ignore close errors during failed initialization.
    }
    throw error;
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

export function fromSqliteJson<T>(raw: unknown, fallback: T): T {
  return fromJson(raw, fallback);
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
