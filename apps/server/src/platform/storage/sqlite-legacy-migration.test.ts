import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateLegacyJsonIfNeeded } from "./sqlite-legacy-migration";

const DEFAULT_SETTING_KEYS = {
  activeProjectId: "active_project_id",
  activeAgentId: "active_agent_id",
  uiSettings: "ui_settings",
  projectRoots: "project_roots",
  mcpServers: "mcp_servers",
  appConfig: "app_config",
} as const;
const REJECTS_SYMLINK_FILE_REGEX = /rejects symlink file/i;

function createMigrationDb(): Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

function createFullMigrationDb(): Database {
  const db = createMigrationDb();
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE usage_stats_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      project_id TEXT,
      project_root TEXT,
      chat_id TEXT,
      agent_session_id TEXT,
      turn_id TEXT,
      provider_id TEXT,
      provider_display_name TEXT,
      status TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE usage_telemetry_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

async function createSymlinkOrSkip(target: string, linkPath: string) {
  try {
    await symlink(target, linkPath);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      return false;
    }
    throw error;
  }
}

describe("sqlite legacy migration hardening", () => {
  test("rejects symlink legacy files", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-mig-"));
    const outsideFile = path.join(storageDir, "outside-projects.json");
    await writeFile(outsideFile, JSON.stringify({ projects: [] }), "utf8");
    const linkedFile = path.join(storageDir, "projects.json");
    const symlinkCreated = await createSymlinkOrSkip(outsideFile, linkedFile);
    if (!symlinkCreated) {
      await rm(storageDir, { recursive: true, force: true });
      return;
    }

    const db = createMigrationDb();
    try {
      await expect(
        migrateLegacyJsonIfNeeded({
          db,
          storageDir,
          jsonMigrationMarkerKey: "json_migrated",
          settingKeys: DEFAULT_SETTING_KEYS,
          runInImmediateTransaction: (_connection, fn) => fn(),
        })
      ).rejects.toThrowError(REJECTS_SYMLINK_FILE_REGEX);
    } finally {
      db.close();
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  test("imports legacy usage stats into primary SQLite tables", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-mig-"));
    await writeFile(
      path.join(storageDir, "usage-stats.json"),
      JSON.stringify({
        version: 1,
        recordsByUserId: {
          "user-1": [
            {
              id: "usage-1",
              userId: "user-1",
              kind: "prompt_sent",
              projectId: "project-1",
              projectRoot: "/repo",
              chatId: "chat-1",
              turnId: "turn-1",
              inputTokens: 10,
              outputTokens: 5,
              createdAt: 100,
            },
          ],
        },
        telemetryByUserId: {
          "user-1": {
            enabled: true,
            updatedAt: 200,
          },
        },
      }),
      "utf8"
    );

    const db = createFullMigrationDb();
    try {
      await migrateLegacyJsonIfNeeded({
        db,
        storageDir,
        jsonMigrationMarkerKey: "json_migrated",
        settingKeys: DEFAULT_SETTING_KEYS,
        runInImmediateTransaction: (_connection, fn) => fn(),
      });

      const record = db
        .query(
          `SELECT
            id,
            user_id AS userId,
            kind,
            project_id AS projectId,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            created_at AS createdAt
          FROM usage_stats_records
          WHERE id = ?`
        )
        .get("usage-1") as Record<string, unknown> | null;
      const telemetry = db
        .query(
          `SELECT
            user_id AS userId,
            enabled,
            updated_at AS updatedAt
          FROM usage_telemetry_settings
          WHERE user_id = ?`
        )
        .get("user-1") as Record<string, unknown> | null;

      expect(record).toEqual({
        id: "usage-1",
        userId: "user-1",
        kind: "prompt_sent",
        projectId: "project-1",
        inputTokens: 10,
        outputTokens: 5,
        createdAt: 100,
      });
      expect(telemetry).toEqual({
        userId: "user-1",
        enabled: 1,
        updatedAt: 200,
      });
    } finally {
      db.close();
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
