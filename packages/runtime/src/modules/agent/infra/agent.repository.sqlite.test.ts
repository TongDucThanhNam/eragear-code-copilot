import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import type { AgentInput } from "#runtime/shared/types/agent.types";
import { AgentSqliteRepository } from "./agent.repository.sqlite";

describe("AgentSqliteRepository active-agent lifecycle", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();

    tempStorageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-agent-"));
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

  test("sets the first created agent active behind the repository seam", async () => {
    const repository = new AgentSqliteRepository();

    const created = await repository.createAndEnsureActive(
      createAgentInput("user-1", "Codex")
    );

    await expect(repository.getActiveId("user-1")).resolves.toBe(created.id);
  });

  test("deletes the active agent and selects a remaining fallback", async () => {
    const repository = new AgentSqliteRepository();
    const first = await repository.createAndEnsureActive(
      createAgentInput("user-1", "Codex")
    );
    const second = await repository.createAndEnsureActive(
      createAgentInput("user-1", "Claude")
    );

    const result = await repository.deleteAndRepairActive(first.id, "user-1");

    expect(result.activeAgentId).toBe(second.id);
    await expect(repository.getActiveId("user-1")).resolves.toBe(second.id);
  });

  test("listing initializes missing active state", async () => {
    const repository = new AgentSqliteRepository();
    const created = await repository.create(
      createAgentInput("user-1", "Codex")
    );

    const result = await repository.listByProjectWithActiveState(
      undefined,
      "user-1"
    );

    expect(result.activeAgentId).toBe(created.id);
    expect(result.agents.map((agent) => agent.id)).toEqual([created.id]);
    await expect(repository.getActiveId("user-1")).resolves.toBe(created.id);
  });

  test("listing repairs dangling active state", async () => {
    const repository = new AgentSqliteRepository();
    const first = await repository.create(createAgentInput("user-1", "Codex"));
    const second = await repository.create(
      createAgentInput("user-1", "Claude")
    );
    await repository.setActive(first.id, "user-1");
    await repository.delete(first.id, "user-1");

    const result = await repository.listByProjectWithActiveState(
      undefined,
      "user-1"
    );

    expect(result.activeAgentId).toBe(second.id);
    expect(result.agents.map((agent) => agent.id)).toEqual([second.id]);
    await expect(repository.getActiveId("user-1")).resolves.toBe(second.id);
  });
});

function createAgentInput(
  userId: string,
  name: string,
  projectId: string | null = null
): AgentInput {
  return {
    userId,
    name,
    type: "codex",
    command: "codex",
    args: ["acp"],
    env: {},
    projectId,
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
