import { describe, expect, test } from "bun:test";
import {
  createDefaultSupervisorRunLimits,
  SUPERVISOR_RUN_LIMIT_CAPS,
  SupervisorRunStateSchema,
} from "./supervisor-run.schemas";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

describe("SupervisorRunStateSchema", () => {
  test("accepts a strict versioned run/task/attempt aggregate", () => {
    const run = createSupervisorRunFixture();
    expect(run.schemaVersion).toBe(2);
    expect(run.limits.maxConcurrency).toBe(2);
    expect(run.tasks.map((task) => task.taskId)).toEqual(["task-a", "task-b"]);
  });

  test("rejects unknown fields and limits above hard caps", () => {
    expect(
      SupervisorRunStateSchema.safeParse({
        ...createSupervisorRunFixture(),
        unsafeExtra: true,
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...createSupervisorRunFixture(),
        limits: {
          ...createDefaultSupervisorRunLimits(),
          maxConcurrency: SUPERVISOR_RUN_LIMIT_CAPS.maxConcurrency + 1,
        },
      }).success
    ).toBeFalse();
  });

  test("rejects duplicate, unknown, self, and cyclic dependencies", () => {
    const base = createSupervisorRunFixture();
    const cases = [
      [base.tasks[0], { ...base.tasks[1], taskId: "task-a" }],
      [base.tasks[0], { ...base.tasks[1], dependencies: ["missing"] }],
      [base.tasks[0], { ...base.tasks[1], dependencies: ["task-b"] }],
      [
        { ...base.tasks[0], dependencies: ["task-b"] },
        { ...base.tasks[1], dependencies: ["task-a"] },
      ],
    ];
    for (const tasks of cases) {
      expect(
        SupervisorRunStateSchema.safeParse({ ...base, tasks }).success
      ).toBeFalse();
    }
  });

  test("rejects attempt counts above the run limit and invalid terminal evidence", () => {
    const base = createSupervisorRunFixture({
      limits: {
        ...createDefaultSupervisorRunLimits(),
        maxAttemptsPerTask: 1,
      },
    });
    const attempt = {
      attemptId: "attempt-1",
      chatId: "chat-1",
      agentId: "agent-1",
      idempotencyKey: "run-1:task-a:1",
      status: "terminal" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
    };
    expect(
      SupervisorRunStateSchema.safeParse({
        ...base,
        tasks: [
          {
            ...base.tasks[0],
            attempts: [attempt, { ...attempt, attemptId: "attempt-2" }],
          },
          base.tasks[1],
        ],
      }).success
    ).toBeFalse();
    expect(
      SupervisorRunStateSchema.safeParse({
        ...base,
        tasks: [{ ...base.tasks[0], attempts: [attempt] }, base.tasks[1]],
      }).success
    ).toBeFalse();
  });
});
