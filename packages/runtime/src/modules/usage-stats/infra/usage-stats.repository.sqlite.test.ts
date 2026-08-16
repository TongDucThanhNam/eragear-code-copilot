import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import type { UsageStatsRecord } from "../application/contracts/usage-stats.contract";
import { UsageStatsSqliteRepository } from "./usage-stats.repository.sqlite";

function createRecord(
  id: string,
  userId: string,
  createdAt: number
): UsageStatsRecord {
  return {
    id,
    userId,
    kind: "prompt_sent",
    projectId: "project-1",
    projectRoot: "/repo",
    chatId: "chat-1",
    turnId: "turn-1",
    inputTokens: 10,
    outputTokens: 5,
    createdAt,
  };
}

describe("UsageStatsSqliteRepository", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();

    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-usage-stats-sqlite-")
    );
    process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
    resetStoragePathCacheForTests();
  });

  afterEach(async () => {
    await closeSqliteStorage();
    resetStoragePathCacheForTests();

    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }

    if (tempStorageDir) {
      await removeTempDirWithRetry(tempStorageDir);
    }
  });

  test("appends and lists records for the requested user and range", async () => {
    const repo = new UsageStatsSqliteRepository();

    await repo.appendRecord(createRecord("usage-1", "user-1", 100));
    await repo.appendRecord(createRecord("usage-2", "user-1", 200));
    await repo.appendRecord(createRecord("usage-3", "user-2", 300));

    const records = await repo.listRecords("user-1", {
      sinceMs: 150,
    });

    expect(records.map((record) => record.id)).toEqual(["usage-2"]);
  });

  test("retains the newest records per user", async () => {
    const repo = new UsageStatsSqliteRepository({ maxRecordsPerUser: 2 });

    await repo.appendRecord(createRecord("usage-1", "user-1", 100));
    await repo.appendRecord(createRecord("usage-2", "user-1", 200));
    await repo.appendRecord(createRecord("usage-3", "user-1", 300));

    const records = await repo.listRecords("user-1");

    expect(records.map((record) => record.id)).toEqual(["usage-3", "usage-2"]);
  });

  test("round-trips quota window snapshots for cycle correlation", async () => {
    const repo = new UsageStatsSqliteRepository();
    const quotaRecord: UsageStatsRecord = {
      id: "quota-1",
      userId: "user-1",
      kind: "quota_refreshed",
      providerId: "openai",
      providerDisplayName: "OpenAI / ChatGPT",
      status: "ready",
      quotaWindows: [
        {
          id: "5h",
          label: "5h",
          usageKind: "model_tokens",
          percentRemaining: 52,
          startedAt: "2026-08-09T00:00:00.000Z",
          resetAt: "2026-08-09T05:00:00.000Z",
          durationMs: 18_000_000,
        },
      ],
      createdAt: 100,
    };

    await repo.appendRecord(quotaRecord);

    await expect(repo.listRecords("user-1")).resolves.toEqual([quotaRecord]);
  });

  test("upserts telemetry settings by user", async () => {
    const repo = new UsageStatsSqliteRepository();

    expect(
      await repo.readTelemetrySettings("user-1", (snapshot) => snapshot.get())
    ).toBeNull();

    await repo.mutateTelemetrySettings("user-1", (snapshot) => {
      snapshot.set({
        enabled: true,
        updatedAt: 10,
      });
    });
    await repo.mutateTelemetrySettings("user-1", (snapshot) => {
      snapshot.set({
        enabled: false,
        updatedAt: 20,
      });
    });

    expect(
      await repo.readTelemetrySettings("user-1", (snapshot) => snapshot.get())
    ).toEqual({
      enabled: false,
      updatedAt: 20,
    });
  });

  test("exposes telemetry settings methods used by the SQLite worker", async () => {
    const repo = new UsageStatsSqliteRepository();

    expect(await repo.getTelemetrySettings("user-1")).toBeNull();

    await expect(
      repo.saveTelemetrySettings("user-1", {
        enabled: true,
        updatedAt: 30,
      })
    ).resolves.toEqual({
      enabled: true,
      updatedAt: 30,
    });

    expect(await repo.getTelemetrySettings("user-1")).toEqual({
      enabled: true,
      updatedAt: 30,
    });
  });
});

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      if (attempt === 9) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
