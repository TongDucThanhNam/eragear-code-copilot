import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskAutoArchiveFileRepository } from "./task-auto-archive-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("TaskAutoArchiveFileRepository", () => {
  test("persists task auto-archive snapshots", async () => {
    const filePath = path.join(tempDir, "task-auto-archive.json");
    const repository = new TaskAutoArchiveFileRepository({
      filePath: () => filePath,
    });

    await expect(
      repository.read((snapshot) => ({
        settings: snapshot.settingsByUserId,
        lastRuns: snapshot.lastRunByUserId,
      }))
    ).resolves.toEqual({
      settings: {},
      lastRuns: {},
    });

    await repository.mutate((snapshot) => {
      snapshot.settingsByUserId["user-1"] = {
        enabled: true,
        olderThanDays: 14,
        userConfigured: true,
        updatedAt: "2026-06-17T00:00:00.000Z",
        lastRunAt: "2026-06-17T01:00:00.000Z",
      };
      snapshot.lastRunByUserId["user-1"] = {
        checkedAt: "2026-06-17T01:00:00.000Z",
        cutoffMs: 100,
        dryRun: false,
        inspected: 1,
        archived: 1,
        eligible: 1,
        skippedPinned: 0,
        skippedRunning: 0,
        skippedArchived: 0,
        skippedRecent: 0,
        failed: 0,
        userIds: ["user-1"],
        archivedSessionIds: ["session-1"],
        diagnostics: [],
      };
    });

    await expect(
      repository.read((snapshot) => snapshot.lastRunByUserId["user-1"])
    ).resolves.toMatchObject({
      archived: 1,
      archivedSessionIds: ["session-1"],
    });

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("user-1");
    expect(raw).toContain("session-1");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-task-auto-archive-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
