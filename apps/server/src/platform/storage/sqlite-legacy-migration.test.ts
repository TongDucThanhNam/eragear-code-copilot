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
});
