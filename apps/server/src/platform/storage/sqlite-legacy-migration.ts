import type { Database } from "bun:sqlite";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@/platform/logging/structured-logger";
import type { AgentConfig } from "@/shared/types/agent.types";
import type { Project } from "@/shared/types/project.types";
import type { StoredSession } from "@/shared/types/session.types";
import type { Settings } from "@/shared/types/settings.types";
import { stringifyJson } from "@/shared/utils/json.util";
import { isNodeErrno } from "@/shared/utils/node-error.util";

const logger = createLogger("Storage");

const LEGACY_JSON_FILES = [
  "projects.json",
  "sessions.json",
  "agents.json",
  "ui-settings.json",
  "usage-stats.json",
] as const;

const SQLITE_VARIABLE_LIMIT = 999;
const PROJECT_IMPORT_CHUNK_SIZE = 80;
const AGENT_IMPORT_CHUNK_SIZE = 80;
const SESSION_IMPORT_CHUNK_SIZE = 25;
const MESSAGE_IMPORT_CHUNK_SIZE = 80;
const USAGE_STATS_RECORD_IMPORT_CHUNK_SIZE = 45;
const USAGE_STATS_TELEMETRY_IMPORT_CHUNK_SIZE = 200;

interface LegacyProjectsData {
  projects?: Project[];
  activeProjectId?: string | null;
}

interface LegacyAgentsData {
  agents?: AgentConfig[];
  activeAgentId?: string | null;
}

interface LegacyJsonData {
  projects: Project[];
  activeProjectId: string | null;
  sessions: StoredSession[];
  agents: AgentConfig[];
  activeAgentId: string | null;
  settings: Settings | null;
  usageStats: LegacyUsageStatsFile | null;
}

type UsageStatsRecordKind =
  | "prompt_sent"
  | "turn_completed"
  | "quota_refreshed";
type SqlDataTable =
  | "projects"
  | "sessions"
  | "agents"
  | "usage_stats_records"
  | "usage_telemetry_settings";
type SqlitePrimitive = string | number | null;

interface LegacyUsageStatsRecord {
  id?: unknown;
  userId?: unknown;
  kind?: unknown;
  projectId?: unknown;
  projectRoot?: unknown;
  chatId?: unknown;
  agentSessionId?: unknown;
  turnId?: unknown;
  providerId?: unknown;
  providerDisplayName?: unknown;
  status?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  createdAt?: unknown;
}

interface LegacyUsageTelemetrySettings {
  enabled?: unknown;
  updatedAt?: unknown;
}

interface LegacyUsageStatsFile {
  version?: unknown;
  recordsByUserId?: Record<string, LegacyUsageStatsRecord[]>;
  telemetryByUserId?: Record<string, LegacyUsageTelemetrySettings>;
}

interface BulkInsertParams {
  db: Database;
  prefixSql: string;
  rows: SqlitePrimitive[][];
  columnCount: number;
  preferredChunkSize: number;
}

export interface LegacyMigrationSettingKeys {
  activeProjectId: string;
  activeAgentId: string;
  uiSettings: string;
  projectRoots: string;
  mcpServers: string;
  appConfig: string;
}

interface MigrateLegacyJsonParams {
  db: Database;
  storageDir: string;
  jsonMigrationMarkerKey: string;
  settingKeys: LegacyMigrationSettingKeys;
  runInImmediateTransaction: <T>(db: Database, fn: () => T) => T;
}

interface LegacyFileEntry {
  filename: (typeof LEGACY_JSON_FILES)[number];
  filePath: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertPathInsideRoot(rootPath: string, targetPath: string): void {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `[Storage] Legacy migration file escapes storage root: ${targetPath}`
    );
  }
}

async function resolveSafeStorageDir(storageDir: string): Promise<string> {
  const resolved = path.resolve(storageDir);
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `[Storage] Legacy migration rejects symlink storageDir: ${resolved}`
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `[Storage] Legacy migration storageDir must be a directory: ${resolved}`
    );
  }
  return await realpath(resolved);
}

async function resolveSafeLegacyFileEntries(
  storageDir: string
): Promise<LegacyFileEntry[]> {
  const safeStorageDir = await resolveSafeStorageDir(storageDir);
  const entries: LegacyFileEntry[] = [];
  for (const filename of LEGACY_JSON_FILES) {
    const candidatePath = path.join(safeStorageDir, filename);
    if (!(await pathExists(candidatePath))) {
      continue;
    }
    const stats = await lstat(candidatePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `[Storage] Legacy migration rejects symlink file: ${candidatePath}`
      );
    }
    if (!stats.isFile()) {
      throw new Error(
        `[Storage] Legacy migration expects regular file: ${candidatePath}`
      );
    }
    const realCandidatePath = await realpath(candidatePath);
    assertPathInsideRoot(safeStorageDir, realCandidatePath);
    entries.push({
      filename,
      filePath: realCandidatePath,
    });
  }
  return entries;
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

function getMeta(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM app_meta WHERE key = ?").get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}

function hasSqlData(db: Database): boolean {
  return (
    tableHasRows(db, "projects") ||
    tableHasRows(db, "sessions") ||
    tableHasRows(db, "agents")
  );
}

function tableHasRows(db: Database, tableName: SqlDataTable): boolean {
  const row = db
    .query(`SELECT 1 AS has_row FROM ${tableName} LIMIT 1`)
    .get() as { has_row: number } | null;
  return row !== null;
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
    if (isNodeErrno(error, "ENOENT")) {
      return undefined;
    }
    throw new Error(`Failed to parse legacy JSON file: ${filePath}`, {
      cause: error,
    });
  }
}

async function backupLegacyFiles(
  storageDir: string,
  filesToBackup: LegacyFileEntry[]
): Promise<void> {
  if (filesToBackup.length === 0) {
    return;
  }

  const backupDir = await mkdtemp(path.join(storageDir, "backup-"));
  await Promise.all(
    filesToBackup.map(async (entry) => {
      await copyFile(
        entry.filePath,
        path.join(backupDir, entry.filename),
        fsConstants.COPYFILE_EXCL
      );
    })
  );
}

function importLegacyProjects(db: Database, projects: Project[]): void {
  const rows: SqlitePrimitive[][] = projects.map((project) => [
    project.id,
    project.name,
    project.path,
    project.description ?? null,
    stringifyJson(project.tags ?? []),
    project.obsidianProjectPath ?? null,
    stringifyJson(project.techStackTags ?? []),
    project.favorite ? 1 : 0,
    project.createdAt,
    project.updatedAt,
    project.lastOpenedAt ?? null,
  ]);

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO projects (
      id, name, path, description, tags_json, obsidian_project_path, tech_stack_tags_json, favorite, created_at, updated_at, last_opened_at
    ) VALUES`,
    rows,
    columnCount: 11,
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

    const sessionMessages = session.messages ?? [];
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
      toJson(session.modes),
      toJson(session.models),
      toJson(session.configOptions),
      toJson(session.plan),
      toJson(session.commands),
      toJson(session.agentCapabilities),
      toJson(session.authMethods),
      sessionMessages.length,
    ]);

    for (const message of sessionMessages) {
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
      status, pinned, archived, created_at, last_active_at, mode_id, model_id,
      modes_json, models_json, config_options_json, plan_json,
      commands_json, agent_capabilities_json, auth_methods_json, message_count
    ) VALUES`,
    rows: sessionRows,
    columnCount: 28,
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
}

function importLegacySettings(params: {
  db: Database;
  activeProjectId: string | null;
  projectIds: Set<string>;
  activeAgentId: string | null;
  agents: AgentConfig[];
  settings: Settings | null;
  settingKeys: LegacyMigrationSettingKeys;
}): void {
  const {
    db,
    activeProjectId,
    projectIds,
    activeAgentId,
    agents,
    settings,
    settingKeys,
  } = params;

  if (activeProjectId && projectIds.has(activeProjectId)) {
    setSqliteSettingIfMissing(db, settingKeys.activeProjectId, activeProjectId);
  } else {
    setSqliteSettingIfMissing(db, settingKeys.activeProjectId, null);
  }

  const agentIds = new Set(agents.map((agent) => agent.id));
  if (activeAgentId && agentIds.has(activeAgentId)) {
    setSqliteSettingIfMissing(db, settingKeys.activeAgentId, activeAgentId);
  } else {
    setSqliteSettingIfMissing(db, settingKeys.activeAgentId, null);
  }

  if (!settings) {
    return;
  }

  setSqliteSettingIfMissing(db, settingKeys.uiSettings, settings.ui);
  setSqliteSettingIfMissing(
    db,
    settingKeys.projectRoots,
    settings.projectRoots ?? []
  );
  setSqliteSettingIfMissing(
    db,
    settingKeys.mcpServers,
    settings.mcpServers ?? []
  );
  setSqliteSettingIfMissing(db, settingKeys.appConfig, settings.app ?? null);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeUsageRecordKind(value: unknown): UsageStatsRecordKind | null {
  if (
    value === "prompt_sent" ||
    value === "turn_completed" ||
    value === "quota_refreshed"
  ) {
    return value;
  }
  return null;
}

function toLegacyUsageRecordRow(
  userId: string,
  record: LegacyUsageStatsRecord
): SqlitePrimitive[] | null {
  const id = normalizeOptionalString(record.id);
  const recordUserId = normalizeOptionalString(record.userId) ?? userId;
  const kind = normalizeUsageRecordKind(record.kind);
  const createdAt = normalizeNonNegativeInteger(record.createdAt);
  if (!(id && recordUserId && kind && createdAt !== null)) {
    return null;
  }

  return [
    id,
    recordUserId,
    kind,
    normalizeOptionalString(record.projectId),
    normalizeOptionalString(record.projectRoot),
    normalizeOptionalString(record.chatId),
    normalizeOptionalString(record.agentSessionId),
    normalizeOptionalString(record.turnId),
    normalizeOptionalString(record.providerId),
    normalizeOptionalString(record.providerDisplayName),
    normalizeOptionalString(record.status),
    normalizeNonNegativeInteger(record.inputTokens),
    normalizeNonNegativeInteger(record.outputTokens),
    createdAt,
  ];
}

function importLegacyUsageStats(
  db: Database,
  usageStats: LegacyUsageStatsFile | null
): void {
  if (!usageStats) {
    return;
  }

  const recordRows: SqlitePrimitive[][] = [];
  const recordsByUserId = usageStats.recordsByUserId ?? {};
  for (const [userId, records] of Object.entries(recordsByUserId)) {
    if (!Array.isArray(records)) {
      continue;
    }
    for (const record of records) {
      const row = toLegacyUsageRecordRow(userId, record);
      if (row) {
        recordRows.push(row);
      }
    }
  }

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO usage_stats_records (
      id, user_id, kind, project_id, project_root, chat_id, agent_session_id,
      turn_id, provider_id, provider_display_name, status, input_tokens,
      output_tokens, created_at
    ) VALUES`,
    rows: recordRows,
    columnCount: 14,
    preferredChunkSize: USAGE_STATS_RECORD_IMPORT_CHUNK_SIZE,
  });

  const telemetryRows: SqlitePrimitive[][] = [];
  const telemetryByUserId = usageStats.telemetryByUserId ?? {};
  for (const [userId, settings] of Object.entries(telemetryByUserId)) {
    const normalizedUserId = normalizeOptionalString(userId);
    const updatedAt = normalizeNonNegativeInteger(settings?.updatedAt);
    if (!(normalizedUserId && updatedAt !== null)) {
      continue;
    }
    telemetryRows.push([
      normalizedUserId,
      settings.enabled === true ? 1 : 0,
      updatedAt,
    ]);
  }

  runBulkInsert({
    db,
    prefixSql: `INSERT OR IGNORE INTO usage_telemetry_settings (
      user_id, enabled, updated_at
    ) VALUES`,
    rows: telemetryRows,
    columnCount: 3,
    preferredChunkSize: USAGE_STATS_TELEMETRY_IMPORT_CHUNK_SIZE,
  });
}

function importLegacyData(params: {
  db: Database;
  projects: Project[];
  activeProjectId: string | null;
  agents: AgentConfig[];
  activeAgentId: string | null;
  settings: Settings | null;
  sessions: StoredSession[];
  usageStats: LegacyUsageStatsFile | null;
  settingKeys: LegacyMigrationSettingKeys;
}) {
  const {
    db,
    projects,
    activeProjectId,
    agents,
    activeAgentId,
    settings,
    settingKeys,
    usageStats,
  } = params;
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
    settingKeys,
  });
  importLegacyUsageStats(db, usageStats);
}

async function getExistingLegacyFiles(
  storageDir: string
): Promise<LegacyFileEntry[]> {
  return await resolveSafeLegacyFileEntries(storageDir);
}

async function loadLegacyData(
  storageDir: string,
  existingLegacyFiles: LegacyFileEntry[]
): Promise<LegacyJsonData> {
  const fileMap = new Map(
    existingLegacyFiles.map(
      (entry) => [entry.filename, entry.filePath] as const
    )
  );
  const resolveLegacyFilePath = (
    filename: (typeof LEGACY_JSON_FILES)[number]
  ) => fileMap.get(filename) ?? path.join(storageDir, filename);
  const projectsData =
    (await readLegacyJsonFile<LegacyProjectsData>(
      resolveLegacyFilePath("projects.json")
    )) ?? {};
  const sessionsData =
    (await readLegacyJsonFile<StoredSession[]>(
      resolveLegacyFilePath("sessions.json")
    )) ?? [];
  const agentsData =
    (await readLegacyJsonFile<LegacyAgentsData>(
      resolveLegacyFilePath("agents.json")
    )) ?? {};
  const settingsData =
    (await readLegacyJsonFile<Settings>(
      resolveLegacyFilePath("ui-settings.json")
    )) ?? null;
  const usageStatsData =
    (await readLegacyJsonFile<LegacyUsageStatsFile>(
      resolveLegacyFilePath("usage-stats.json")
    )) ?? null;

  return {
    projects: Array.isArray(projectsData.projects) ? projectsData.projects : [],
    activeProjectId: projectsData.activeProjectId ?? null,
    sessions: Array.isArray(sessionsData) ? sessionsData : [],
    agents: Array.isArray(agentsData.agents) ? agentsData.agents : [],
    activeAgentId: agentsData.activeAgentId ?? null,
    settings: settingsData,
    usageStats: usageStatsData,
  };
}

export async function migrateLegacyJsonIfNeeded(
  params: MigrateLegacyJsonParams
): Promise<void> {
  const {
    db,
    storageDir,
    jsonMigrationMarkerKey,
    settingKeys,
    runInImmediateTransaction,
  } = params;

  if (getMeta(db, jsonMigrationMarkerKey) === "1") {
    return;
  }

  const safeStorageDir = await resolveSafeStorageDir(storageDir);
  const existingLegacyFiles = await getExistingLegacyFiles(safeStorageDir);
  const shouldImportLegacyData = existingLegacyFiles.length > 0;
  let legacyData: LegacyJsonData | null = null;

  if (shouldImportLegacyData) {
    await backupLegacyFiles(safeStorageDir, existingLegacyFiles);
    legacyData = await loadLegacyData(safeStorageDir, existingLegacyFiles);
  }

  runInImmediateTransaction(db, () => {
    if (getMeta(db, jsonMigrationMarkerKey) === "1") {
      return;
    }

    if (!(shouldImportLegacyData && legacyData)) {
      setMeta(db, jsonMigrationMarkerKey, "1");
      return;
    }

    if (hasSqlData(db)) {
      logger.warn(
        "Legacy JSON migration marker is missing while SQLite already has data. Proceeding with idempotent migration."
      );
    }

    importLegacyData({ db, ...legacyData, settingKeys });
    setMeta(db, jsonMigrationMarkerKey, "1");
  });
}
