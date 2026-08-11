import { describe, expect, test } from "bun:test";
import { SupervisorRunStateSchema } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import { WorkerResultService } from "./worker-result.service";

function createService(run = createSupervisorRunFixture()) {
  let stored = structuredClone(run);
  const runs: SupervisorRunRepositoryPort = {
    create: (next) => {
      stored = structuredClone(next);
      return Promise.resolve(structuredClone(stored));
    },
    get: (runId, userId) =>
      Promise.resolve(
        stored.runId === runId && stored.userId === userId
          ? structuredClone(stored)
          : null
      ),
    list: (input) =>
      Promise.resolve(
        input.userId === stored.userId ? [structuredClone(stored)] : []
      ),
    listNonTerminal: () => Promise.resolve([structuredClone(stored)]),
    save: (next, expectedRevision) => {
      if (stored.revision !== expectedRevision) {
        return Promise.reject(new Error("revision conflict"));
      }
      stored = structuredClone(next);
      return Promise.resolve(structuredClone(stored));
    },
  };
  return new SupervisorOrchestratorService({
    runs,
    planner: {
      plan: async () => ({ proposal: {} as never, tasks: [] }),
      replan: async () => ({ proposal: {} as never, tasks: [] }),
    },
    scheduler: new SupervisorSchedulerService(),
    workers: {} as never,
    agents: { listEligible: async () => [] },
    baseSnapshot: { capture: async () => run.baseSnapshot },
    workspaces: {} as never,
    integration: {} as never,
    results: new WorkerResultService(),
    finalVerifier: { verify: async () => [] },
    now: () => "2026-07-12T00:00:00.000Z",
  });
}

describe("SupervisorOrchestratorService limits", () => {
  test("never dispatches beyond persisted concurrency and has no calendar deadline", () => {
    const scheduler = new SupervisorSchedulerService();
    const task = requireTaskFixture();
    const fixture = createSupervisorRunFixture({
      status: "running",
      limits: { ...createSupervisorRunFixture().limits, maxConcurrency: 1 },
      tasks: [
        {
          ...task,
          taskId: "a",
          status: "ready",
        },
        {
          ...task,
          taskId: "b",
          status: "ready",
        },
      ],
    });
    expect(scheduler.evaluate(fixture).dispatchTaskIds).toHaveLength(1);
    expect(scheduler.evaluate(fixture).dispatchTaskIds).toHaveLength(1);
  });

  test("does not fail a long-lived run solely because time passed", async () => {
    const base = createSupervisorRunFixture();
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: base.tasks.map((task) => ({ ...task, status: "running" })),
    });
    const current = await createService(run).schedule(run.runId, run.userId);
    expect(current.status).toBe("running");
  });

  test("rejects retry and replan counters at their exact budgets", async () => {
    const task = requireTaskFixture();
    const exhausted = createSupervisorRunFixture({
      status: "needs_user",
      plannerReplanCount: 2,
      limits: { ...createSupervisorRunFixture().limits, maxAttemptsPerTask: 1 },
      tasks: [
        {
          ...task,
          status: "failed",
          attempts: [
            {
              attemptId: "attempt-1",
              chatId: "chat-1",
              agentId: "agent-1",
              status: "interrupted",
              idempotencyKey: "attempt-key-1",
              startedAt: "2026-07-11T00:00:00.000Z",
              finishedAt: "2026-07-11T00:01:00.000Z",
            },
          ],
        },
      ],
    });
    const service = createService(exhausted);
    await expect(
      service.retryTask({
        runId: exhausted.runId,
        userId: exhausted.userId,
        taskId: task.taskId,
      })
    ).rejects.toThrow("exhausted its attempt budget");
    await expect(
      service.replan(exhausted.runId, exhausted.userId)
    ).rejects.toThrow("exhausted its replan budget");
  });

  test("schema prevents counters from exceeding hard caps", () => {
    const run = createSupervisorRunFixture();
    expect(() =>
      SupervisorRunStateSchema.parse({
        ...run,
        plannerReplanCount: run.limits.maxPlannerReplans + 1,
      })
    ).toThrow();
  });
});

function requireTaskFixture() {
  const task = createSupervisorRunFixture().tasks[0];
  if (!task) {
    throw new Error("Task fixture missing");
  }
  return task;
}
