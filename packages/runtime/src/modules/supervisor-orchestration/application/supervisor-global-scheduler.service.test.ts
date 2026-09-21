import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  buildWeightedFairRunOrder,
  SupervisorGlobalSchedulerService,
} from "./supervisor-global-scheduler.service";

describe("buildWeightedFairRunOrder", () => {
  test("gives every runnable run one dispatch before spending extra weight", () => {
    const order = buildWeightedFairRunOrder([
      {
        runId: "urgent",
        priority: "urgent",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:00.000Z",
      },
      {
        runId: "low",
        priority: "low",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:01.000Z",
      },
      {
        runId: "normal",
        priority: "normal",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:02.000Z",
      },
      {
        runId: "high",
        priority: "high",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:03.000Z",
      },
    ]);

    expect(order.slice(0, 4)).toEqual(["urgent", "low", "normal", "high"]);
    expect(order.filter((id) => id === "urgent")).toHaveLength(8);
    expect(order.filter((id) => id === "high")).toHaveLength(4);
    expect(order.filter((id) => id === "normal")).toHaveLength(2);
    expect(order.filter((id) => id === "low")).toHaveLength(1);
  });

  test("schedules from lifecycle facts and ignores paused runs", async () => {
    const runnable = createSupervisorRunFixture({
      runId: "run-runnable",
      desiredState: "running",
      phase: "executing",
      activity: "dispatching",
    });
    const paused = createSupervisorRunFixture({
      runId: "run-paused",
      desiredState: "paused",
      phase: "executing",
      activity: "dispatching",
    });
    const scheduled: string[] = [];
    const runs = {
      listNonTerminal: () => Promise.resolve([runnable, paused]),
    } as unknown as SupervisorRunRepositoryPort;
    const scheduler = new SupervisorGlobalSchedulerService({
      runs,
      orchestrator: {
        schedule: (runId) => {
          scheduled.push(runId);
          return Promise.resolve(runnable);
        },
      },
    });

    expect(await scheduler.tick()).toEqual([runnable.runId]);
    expect(scheduled).toEqual([runnable.runId]);
  });

  test("does not let a saturated run consume another project's dispatch slot", async () => {
    const saturated = createSupervisorRunFixture({
      runId: "run-saturated",
      createdAt: "2026-08-10T00:00:00.000Z",
      limits: {
        ...createSupervisorRunFixture().limits,
        maxConcurrency: 1,
      },
    });
    const activeTask = saturated.tasks[0];
    if (!activeTask) {
      throw new Error("Saturated run fixture task missing");
    }
    activeTask.activity = "agent_turn";
    const waitingTask = saturated.tasks[1];
    if (!waitingTask) {
      throw new Error("Saturated run waiting task missing");
    }
    waitingTask.dependencies = [];

    const runnable = createSupervisorRunFixture({
      runId: "run-runnable",
      createdAt: "2026-08-10T00:00:01.000Z",
    });
    const scheduled: string[] = [];
    const runs = {
      listNonTerminal: () => Promise.resolve([saturated, runnable]),
    } as unknown as SupervisorRunRepositoryPort;
    const scheduler = new SupervisorGlobalSchedulerService({
      runs,
      now: () => "2026-08-10T00:01:00.000Z",
      orchestrator: {
        schedule: (runId) => {
          scheduled.push(runId);
          return Promise.resolve(
            runId === saturated.runId ? saturated : runnable
          );
        },
      },
    });

    expect(await scheduler.tick(1)).toEqual([runnable.runId]);
    expect(scheduled).toEqual([runnable.runId]);
  });
});
