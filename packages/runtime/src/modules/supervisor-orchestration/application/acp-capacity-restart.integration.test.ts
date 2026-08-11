import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunSqliteRepository } from "../infra/supervisor-run.repository.sqlite";
import {
  AcpCapacityCoordinator,
  type AcpCapacitySessionLifecyclePort,
} from "./acp-capacity-coordinator.service";

function runningFixture(): SupervisorRunState {
  const base = createSupervisorRunFixture();
  const task = base.tasks[0];
  if (!task) {
    throw new Error("fixture task missing");
  }
  return createSupervisorRunFixture({
    status: "running",
    tasks: [
      {
        ...task,
        status: "running",
        attempts: [
          {
            attemptId: "attempt-1",
            chatId: "chat-1",
            agentSessionId: "acp-session-1",
            agentId: "agent-1",
            isolatedProjectRoot: "C:/worktrees/attempt-1",
            status: "running",
            idempotencyKey: "run-1:task-a:1",
            startedAt: "2026-08-10T10:00:00.000Z",
          },
        ],
      },
    ],
  });
}

describe("ACP capacity restart integration", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();
    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-capacity-restart-")
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

  test("exact-resumes the same session, attempt, and worktree after runtime recreation", async () => {
    const calls: string[] = [];
    const events: string[] = [];
    const sessions: AcpCapacitySessionLifecyclePort = {
      stop: (_userId, chatId) => {
        calls.push(`stop:${chatId}`);
        return Promise.resolve();
      },
      resumeExact: (_userId, chatId) => {
        calls.push(`exact:${chatId}`);
        return Promise.resolve();
      },
    };
    const eventBus: EventBusPort = {
      subscribe: () => () => undefined,
      publish: (event) => {
        events.push(event.type);
        return Promise.resolve();
      },
    };

    const initialRuns = new SupervisorRunSqliteRepository();
    await initialRuns.create(runningFixture());
    const initialCoordinator = createCoordinator(
      initialRuns,
      sessions,
      eventBus
    );
    await initialCoordinator.suspendWorker({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: "attempt-1",
      failure: { error: new Error("quota exhausted") },
    });

    await closeSqliteStorage();
    const restartedRuns = new SupervisorRunSqliteRepository();
    const restartedCoordinator = createCoordinator(
      restartedRuns,
      sessions,
      eventBus
    );
    expect(
      await restartedCoordinator.resumeDue({
        now: "2026-08-10T10:02:00.000Z",
      })
    ).toEqual({ resumed: 1, failedClosed: 0 });

    const final = await restartedRuns.get("run-1", "user-1");
    expect(final?.tasks[0]?.attempts).toHaveLength(1);
    expect(final?.tasks[0]?.attempts[0]).toMatchObject({
      attemptId: "attempt-1",
      chatId: "chat-1",
      agentSessionId: "acp-session-1",
      agentId: "agent-1",
      isolatedProjectRoot: "C:/worktrees/attempt-1",
      status: "running",
    });
    expect(calls).toEqual(["stop:chat-1", "exact:chat-1"]);
    expect(events).toEqual([
      "supervisor_capacity_suspended",
      "supervisor_capacity_resumed",
    ]);
  });
});

function createCoordinator(
  runs: SupervisorRunSqliteRepository,
  sessions: AcpCapacitySessionLifecyclePort,
  eventBus: EventBusPort
): AcpCapacityCoordinator {
  return new AcpCapacityCoordinator({
    runs,
    sessions,
    eventBus,
    now: () => "2026-08-10T10:00:00.000Z",
    createId: (prefix) => `${prefix}-1`,
  });
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  await rm(dir, { recursive: true, force: true });
}
