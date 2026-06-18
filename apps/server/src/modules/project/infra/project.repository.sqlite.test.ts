import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "@/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "@/platform/storage/storage-path";
import type { ProjectInput } from "@/shared/types/project.types";
import { ProjectSqliteRepository } from "./project.repository.sqlite";

describe("ProjectSqliteRepository active-project lifecycle", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();

    tempStorageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-project-"));
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

  test("deletes the active project and clears active state", async () => {
    const repository = new ProjectSqliteRepository();
    const first = await repository.create(createProjectInput("user-1", "one"));
    const second = await repository.create(createProjectInput("user-1", "two"));
    await repository.setActive(first.id, "user-1");

    const result = await repository.deleteAndClearActive(first.id, "user-1");

    expect(result.activeProjectId).toBeNull();
    await expect(repository.getActiveId("user-1")).resolves.toBeNull();
    await expect(repository.findById(first.id, "user-1")).resolves.toBe(
      undefined
    );
    await expect(
      repository.findById(second.id, "user-1")
    ).resolves.toMatchObject({ id: second.id });
  });

  test("deletes a non-active project without changing active state", async () => {
    const repository = new ProjectSqliteRepository();
    const first = await repository.create(createProjectInput("user-1", "one"));
    const second = await repository.create(createProjectInput("user-1", "two"));
    await repository.setActive(second.id, "user-1");

    const result = await repository.deleteAndClearActive(first.id, "user-1");

    expect(result.activeProjectId).toBe(second.id);
    await expect(repository.getActiveId("user-1")).resolves.toBe(second.id);
  });

  test("listing returns projects with active state", async () => {
    const repository = new ProjectSqliteRepository();
    const first = await repository.create(createProjectInput("user-1", "one"));
    const second = await repository.create(createProjectInput("user-1", "two"));
    await repository.setActive(second.id, "user-1");

    const result = await repository.listWithActiveState("user-1");

    expect(result.activeProjectId).toBe(second.id);
    expect(result.projects.map((project) => project.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  test("listing repairs dangling active state to null", async () => {
    const repository = new ProjectSqliteRepository();
    const first = await repository.create(createProjectInput("user-1", "one"));
    const second = await repository.create(createProjectInput("user-1", "two"));
    await repository.setActive(first.id, "user-1");
    await repository.delete(first.id, "user-1");

    const result = await repository.listWithActiveState("user-1");

    expect(result.activeProjectId).toBeNull();
    expect(result.projects.map((project) => project.id)).toEqual([second.id]);
    await expect(repository.getActiveId("user-1")).resolves.toBeNull();
  });
});

function createProjectInput(userId: string, suffix: string): ProjectInput {
  return {
    userId,
    name: `Project ${suffix}`,
    path: path.resolve(os.tmpdir(), `eragear-project-${userId}-${suffix}`),
    tags: [],
    techStackTags: [],
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
