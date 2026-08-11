import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  closeSqliteStorage,
  getSqliteOrm,
  sqliteSchema,
} from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import {
  SupervisorRunRevisionConflictError,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import { SupervisorRunSqliteRepository } from "./supervisor-run.repository.sqlite";

describe("SupervisorRunSqliteRepository", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-supervisor-runs-")
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
    await removeTempDirWithRetry(tempStorageDir);
  });

  test("survives repository and SQLite recreation with ownership filtering", async () => {
    const run = createSupervisorRunFixture();
    await new SupervisorRunSqliteRepository().create(run);
    expect(
      await new SupervisorRunSqliteRepository().get(run.runId, "other-user")
    ).toBeNull();

    await closeSqliteStorage();
    const recreated = new SupervisorRunSqliteRepository();
    expect(await recreated.get(run.runId, run.userId)).toEqual(run);
    expect(
      (await recreated.list({ userId: run.userId })).map((item) => item.runId)
    ).toEqual([run.runId]);
  });

  test("uses compare-and-swap and leaves the stored document atomic on conflict", async () => {
    const repo = new SupervisorRunSqliteRepository();
    const run = await repo.create(createSupervisorRunFixture());
    const revisionOne = transitionSupervisorRun(run, {
      expectedRevision: 0,
      now: "2026-07-11T00:01:00.000Z",
      mutate(draft) {
        draft.status = "running";
      },
    });
    await repo.save(revisionOne, 0);
    const stale = transitionSupervisorRun(run, {
      expectedRevision: 0,
      now: "2026-07-11T00:02:00.000Z",
      mutate(draft) {
        draft.status = "paused";
      },
    });
    await expect(repo.save(stale, 0)).rejects.toBeInstanceOf(
      SupervisorRunRevisionConflictError
    );
    expect(await repo.get(run.runId, run.userId)).toEqual(revisionOne);
  });

  test("migrates version zero documents and rejects corrupt stored state", async () => {
    const repo = new SupervisorRunSqliteRepository();
    const run = createSupervisorRunFixture({ runId: "legacy-run" });
    await repo.create(run);
    const orm = await getSqliteOrm();
    const legacy = structuredClone(run) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 0;
    Reflect.deleteProperty(legacy, "gates");
    Reflect.deleteProperty(legacy, "processedEventIds");
    Reflect.deleteProperty(legacy, "plannerReplanCount");
    Reflect.deleteProperty(legacy, "finalVerification");
    const baseSnapshot = legacy.baseSnapshot as Record<string, unknown>;
    Reflect.deleteProperty(baseSnapshot, "targetFingerprints");
    orm
      .update(sqliteSchema.supervisorRuns)
      .set({ schemaVersion: 0, stateJson: JSON.stringify(legacy) })
      .where(eq(sqliteSchema.supervisorRuns.runId, run.runId))
      .run();
    expect(await repo.get(run.runId, run.userId)).toMatchObject({
      schemaVersion: 2,
      status: "needs_user",
      migratedFromVersion: 1,
    });

    orm
      .update(sqliteSchema.supervisorRuns)
      .set({ schemaVersion: 1, stateJson: "{broken" })
      .where(eq(sqliteSchema.supervisorRuns.runId, run.runId))
      .run();
    await expect(repo.get(run.runId, run.userId)).rejects.toThrow(
      "Corrupt supervisor run JSON"
    );
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
