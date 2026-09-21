import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import { GoalIntakeRevisionConflictError, type GoalIntakeState } from "..";
import { GoalIntakeSqliteRepository } from "./goal-intake.repository.sqlite";

describe("GoalIntakeSqliteRepository", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-goal-intake-")
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

  test("enforces ownership on reads, lists, and saves", async () => {
    const repository = new GoalIntakeSqliteRepository();
    const owned = createGoalIntakeState({
      intakeId: "intake-owned",
      userId: "user-owner",
      projectId: "project-1",
    });
    await repository.create(owned);

    await expect(
      repository.get(owned.intakeId, "user-other")
    ).resolves.toBeNull();
    await expect(
      repository.list({ userId: "user-other", includeConverted: true })
    ).resolves.toEqual([]);

    const foreignUpdate = {
      ...owned,
      userId: "user-other",
      revision: 1,
      updatedAt: "2026-08-18T01:00:00.000Z",
    };
    await expect(repository.save(foreignUpdate, 0)).rejects.toMatchObject({
      name: "GoalIntakeRevisionConflictError",
      intakeId: owned.intakeId,
      expectedRevision: 0,
      actualRevision: -1,
    });

    await expect(repository.get(owned.intakeId, owned.userId)).resolves.toEqual(
      owned
    );
  });

  test("performs atomic compare-and-swap saves", async () => {
    const repository = new GoalIntakeSqliteRepository();
    const initial = createGoalIntakeState({
      intakeId: "intake-cas",
      userId: "user-1",
      projectId: "project-1",
    });
    await repository.create(initial);

    const revisionOne = {
      ...initial,
      revision: 1,
      roughOutcome: "Build the durable intake workflow",
      updatedAt: "2026-08-18T01:00:00.000Z",
    };
    await expect(repository.save(revisionOne, 0)).resolves.toEqual(revisionOne);

    const staleRevisionOne = {
      ...revisionOne,
      roughOutcome: "Overwrite from a stale writer",
      updatedAt: "2026-08-18T02:00:00.000Z",
    };
    const conflict = repository.save(staleRevisionOne, 0);
    await expect(conflict).rejects.toBeInstanceOf(
      GoalIntakeRevisionConflictError
    );
    await expect(conflict).rejects.toMatchObject({
      intakeId: initial.intakeId,
      expectedRevision: 0,
      actualRevision: 1,
    });
    await expect(
      repository.get(initial.intakeId, initial.userId)
    ).resolves.toEqual(revisionOne);

    const rewrittenCreationTime = {
      ...revisionOne,
      revision: 2,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-18T03:00:00.000Z",
    };
    await expect(
      repository.save(rewrittenCreationTime, 1)
    ).rejects.toMatchObject({
      intakeId: initial.intakeId,
      expectedRevision: 1,
      actualRevision: 1,
    });
    await expect(
      repository.get(initial.intakeId, initial.userId)
    ).resolves.toEqual(revisionOne);
  });

  test("rejects duplicate creates without leaking another owner's revision", async () => {
    const repository = new GoalIntakeSqliteRepository();
    const initial = createGoalIntakeState({
      intakeId: "intake-duplicate",
      userId: "user-1",
      projectId: "project-1",
    });
    await repository.create(initial);

    const duplicate = createGoalIntakeState({
      intakeId: initial.intakeId,
      userId: "user-2",
      projectId: "project-2",
    });
    await expect(repository.create(duplicate)).rejects.toMatchObject({
      name: "GoalIntakeRevisionConflictError",
      intakeId: initial.intakeId,
      expectedRevision: -1,
      actualRevision: -1,
    });
  });

  test("scopes listings by owner and project and hides converted intakes by default", async () => {
    const repository = new GoalIntakeSqliteRepository();
    const active = createGoalIntakeState({
      intakeId: "intake-active",
      userId: "user-1",
      projectId: "project-1",
      updatedAt: "2026-08-18T01:00:00.000Z",
    });
    const converted = createGoalIntakeState({
      intakeId: "intake-converted",
      userId: "user-1",
      projectId: "project-1",
      status: "converted",
      updatedAt: "2026-08-18T02:00:00.000Z",
    });
    const anotherProject = createGoalIntakeState({
      intakeId: "intake-project-2",
      userId: "user-1",
      projectId: "project-2",
      updatedAt: "2026-08-18T03:00:00.000Z",
    });
    const anotherOwner = createGoalIntakeState({
      intakeId: "intake-user-2",
      userId: "user-2",
      projectId: "project-1",
      updatedAt: "2026-08-18T04:00:00.000Z",
    });
    await Promise.all(
      [active, converted, anotherProject, anotherOwner].map((state) =>
        repository.create(state)
      )
    );

    await expect(
      repository.list({ userId: "user-1", projectId: "project-1" })
    ).resolves.toEqual([active]);
    await expect(
      repository.list({
        userId: "user-1",
        projectId: "project-1",
        includeConverted: true,
      })
    ).resolves.toEqual([converted, active]);
    await expect(repository.list({ userId: "user-1" })).resolves.toEqual([
      anotherProject,
      active,
    ]);
  });
});

function createGoalIntakeState(input: {
  intakeId: string;
  userId: string;
  projectId: string;
  status?: GoalIntakeState["status"];
  updatedAt?: string;
}): GoalIntakeState {
  const createdAt = "2026-08-18T00:00:00.000Z";
  const status = input.status ?? "interviewing";
  return {
    schemaVersion: 1,
    intakeId: input.intakeId,
    revision: 0,
    userId: input.userId,
    projectId: input.projectId,
    projectRoot: path.resolve(os.tmpdir(), input.projectId),
    roughOutcome: "Build a production-ready goal intake",
    depth: "exhaustive",
    providers: ["chatgpt", "gemini"],
    status,
    discoveryRoundCount: 0,
    messages: [
      {
        messageId: `seed-${input.intakeId}`,
        role: "user",
        kind: "seed",
        content: "Build a production-ready goal intake",
        createdAt,
      },
    ],
    contractRevisions: [],
    consultations: [],
    ...(status === "converted"
      ? { convertedRunId: `run-${input.intakeId}` }
      : {}),
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

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
