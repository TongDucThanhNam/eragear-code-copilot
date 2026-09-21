import { describe, expect, test } from "bun:test";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";

const BEFORE_NOT_BEFORE = "2026-07-11T00:30:00.000Z";
const AFTER_NOT_BEFORE = "2026-07-11T01:30:00.000Z";

function createRun(overrides: Partial<SupervisorRunState> = {}) {
  const base = createSupervisorRunFixture();
  return {
    ...base,
    desiredState: "running" as const,
    phase: "executing" as const,
    activity: "dispatching" as const,
    tasks: [
      {
        ...base.tasks[0],
        taskId: "independent-a",
        dependencies: [],
      },
      {
        ...base.tasks[0],
        taskId: "independent-b",
        dependencies: [],
      },
      {
        ...base.tasks[1],
        taskId: "dependent",
        dependencies: ["independent-a"],
      },
    ],
    ...overrides,
  } as SupervisorRunState;
}

describe("SupervisorSchedulerService", () => {
  test("dispatches independent tasks in parallel up to the persisted cap", () => {
    const decision = new SupervisorSchedulerService().evaluate(createRun());
    expect(decision.dispatchTaskIds).toEqual([
      "independent-a",
      "independent-b",
    ]);
    expect(decision.blockedTaskIds).toEqual(["dependent"]);
    expect(decision.availableCapacity).toBe(2);
  });

  test("counts queued/review/integration work and never exceeds concurrency", () => {
    const run = createRun();
    const first = run.tasks[0];
    const second = run.tasks[1];
    if (!(first && second)) {
      throw new Error("Scheduler fixture tasks missing");
    }
    first.activity = "agent_turn";
    second.activity = "verification";
    const decision = new SupervisorSchedulerService().evaluate(run);
    expect(decision.activeCount).toBe(2);
    expect(decision.availableCapacity).toBe(0);
    expect(decision.dispatchTaskIds).toEqual([]);
  });

  test("unblocks a dependent task only after every dependency completes", () => {
    const run = createRun();
    const first = run.tasks[0];
    const second = run.tasks[1];
    if (!(first && second)) {
      throw new Error("Scheduler fixture tasks missing");
    }
    first.outcome = "succeeded";
    second.activity = "agent_turn";
    const decision = new SupervisorSchedulerService().evaluate(run);
    expect(decision.readyTaskIds).toContain("dependent");
    expect(decision.dispatchTaskIds).toEqual(["dependent"]);
  });

  test("dispatches nothing while paused and has no overall run deadline", () => {
    const scheduler = new SupervisorSchedulerService();
    expect(
      scheduler.evaluate(createRun({ desiredState: "paused" })).dispatchTaskIds
    ).toEqual([]);
    expect(scheduler.evaluate(createRun()).dispatchTaskIds).toHaveLength(2);
  });

  test("does not retry a task after its attempt budget is exhausted", () => {
    const run = createRun({
      limits: {
        ...createSupervisorRunFixture().limits,
        maxAttemptsPerTask: 1,
      },
    });
    const first = run.tasks[0];
    if (!first) {
      throw new Error("Scheduler fixture task missing");
    }
    first.attempts = [
      {
        attemptId: "attempt-1",
        chatId: "chat-1",
        agentId: "agent-1",
        status: "interrupted",
        idempotencyKey: "run:task:1",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: "2026-07-11T00:00:01.000Z",
      },
    ];
    expect(
      new SupervisorSchedulerService().evaluate(run).readyTaskIds
    ).not.toContain(first.taskId);
  });

  test("keeps a task blocked until its not-before fact elapses", () => {
    const run = createRun();
    const first = run.tasks[0];
    if (!first) {
      throw new Error("Scheduler fixture task missing");
    }
    first.notBefore = "2026-07-11T01:00:00.000Z";

    const scheduler = new SupervisorSchedulerService();
    const before = scheduler.evaluate(run, BEFORE_NOT_BEFORE);
    expect(before.readyTaskIds).not.toContain(first.taskId);
    expect(before.blockedTaskIds).toContain(first.taskId);
    expect(before.dispatchTaskIds).toEqual(["independent-b"]);

    const after = scheduler.evaluate(run, AFTER_NOT_BEFORE);
    expect(after.readyTaskIds).toContain(first.taskId);
    expect(after.blockedTaskIds).not.toContain(first.taskId);
    expect(after.dispatchTaskIds).toEqual(["independent-a", "independent-b"]);
    expect(first.notBefore).toBe("2026-07-11T01:00:00.000Z");
  });

  test("dispatches an independent task while another task waits for capacity", () => {
    const run = createRun();
    const waiting = run.tasks[0];
    if (!waiting) {
      throw new Error("Scheduler fixture task missing");
    }
    waiting.activity = "capacity_wait";

    const decision = new SupervisorSchedulerService().evaluate(run);

    expect(decision.dispatchTaskIds).toEqual(["independent-b"]);
    expect(decision.readyTaskIds).toEqual(["independent-b"]);
    expect(decision.activeCount).toBe(0);
  });
});
