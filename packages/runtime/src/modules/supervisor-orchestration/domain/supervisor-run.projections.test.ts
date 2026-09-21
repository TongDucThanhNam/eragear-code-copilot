import { describe, expect, test } from "bun:test";
import {
  deriveSupervisorRunStatus,
  deriveSupervisorTaskStatus,
} from "./supervisor-run.projections";
import type {
  SupervisorRunState,
  SupervisorRunStatus,
  SupervisorTaskStatus,
} from "./supervisor-run.schemas";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

const NOW = "2026-07-11T00:00:00.000Z";

describe("supervisor lifecycle projections", () => {
  test("derives every run compatibility status from orthogonal facts", () => {
    const cases: {
      expected: SupervisorRunStatus;
      arrange(run: SupervisorRunState): void;
    }[] = [
      {
        expected: "draft",
        arrange(run) {
          run.phase = "planning";
          Reflect.deleteProperty(run, "activity");
        },
      },
      {
        expected: "planning",
        arrange(run) {
          run.phase = "planning";
          run.activity = "planning";
        },
      },
      {
        expected: "awaiting_approval",
        arrange(run) {
          run.phase = "planning";
          Reflect.deleteProperty(run, "activity");
          run.plan = unapprovedPlan();
        },
      },
      {
        expected: "queued",
        arrange(run) {
          run.phase = "executing";
          run.activity = "dispatching";
        },
      },
      {
        expected: "running",
        arrange(run) {
          run.phase = "executing";
          run.activity = "executing";
        },
      },
      {
        expected: "waiting_capacity",
        arrange(run) {
          run.activity = "capacity_wait";
        },
      },
      {
        expected: "paused",
        arrange(run) {
          run.desiredState = "paused";
        },
      },
      {
        expected: "needs_user",
        arrange(run) {
          run.blockingDecisionId = "decision-1";
        },
      },
      {
        expected: "completing",
        arrange(run) {
          run.phase = "finalizing";
          run.activity = "finalizing";
        },
      },
      {
        expected: "completed",
        arrange(run) {
          run.phase = "finished";
          run.outcome = "succeeded";
        },
      },
      {
        expected: "failed",
        arrange(run) {
          run.phase = "finished";
          run.outcome = "failed";
        },
      },
      {
        expected: "cancelled",
        arrange(run) {
          run.desiredState = "cancelled";
          run.phase = "finished";
          run.outcome = "cancelled";
        },
      },
    ];

    for (const item of cases) {
      const run = createSupervisorRunFixture();
      item.arrange(run);
      expect(deriveSupervisorRunStatus(run, NOW)).toBe(item.expected);
    }
  });

  test("projects an unfinished cancellation intent as non-terminal paused", () => {
    const run = createSupervisorRunFixture();
    run.desiredState = "cancelled";

    expect(deriveSupervisorRunStatus(run, NOW)).toBe("paused");
  });

  test("scopes task capacity waits without bypassing a true run blocker", () => {
    const run = createSupervisorRunFixture();
    run.phase = "executing";
    run.activity = "dispatching";
    for (const task of run.tasks) {
      task.dependencies = [];
      task.activity = "capacity_wait";
    }

    expect(deriveSupervisorRunStatus(run, NOW)).toBe("waiting_capacity");

    const independent = run.tasks[1];
    if (!independent) {
      throw new Error("Fixture task missing");
    }
    Reflect.deleteProperty(independent, "activity");
    expect(deriveSupervisorRunStatus(run, NOW)).toBe("queued");

    independent.activity = "agent_turn";
    expect(deriveSupervisorRunStatus(run, NOW)).toBe("running");

    run.blockingDecisionId = "run-wide-decision";
    expect(deriveSupervisorRunStatus(run, NOW)).toBe("needs_user");
  });

  test("derives task status from outcomes, blockers, activity, time, and dependencies", () => {
    const run = createSupervisorRunFixture();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    const cases: {
      expected: SupervisorTaskStatus;
      arrange(): void;
    }[] = [
      {
        expected: "ready",
        arrange() {
          // No additional facts are needed for a dependency-free work item.
        },
      },
      {
        expected: "blocked",
        arrange() {
          task.notBefore = "2026-07-11T00:01:00.000Z";
        },
      },
      {
        expected: "queued",
        arrange() {
          task.activity = "dispatching";
        },
      },
      {
        expected: "running",
        arrange() {
          task.activity = "agent_turn";
        },
      },
      {
        expected: "waiting_capacity",
        arrange() {
          task.activity = "capacity_wait";
        },
      },
      {
        expected: "reviewing",
        arrange() {
          task.verification = {
            verificationId: "verification-task-a",
            status: "running",
            evidenceRefs: [],
          };
        },
      },
      {
        expected: "integrating",
        arrange() {
          task.activity = "integration";
        },
      },
      {
        expected: "needs_user",
        arrange() {
          task.blockingDecisionId = "decision-1";
        },
      },
      {
        expected: "completed",
        arrange() {
          task.outcome = "succeeded";
        },
      },
      {
        expected: "failed",
        arrange() {
          task.outcome = "failed";
        },
      },
      {
        expected: "cancelled",
        arrange() {
          task.outcome = "cancelled";
        },
      },
    ];

    for (const item of cases) {
      Reflect.deleteProperty(task, "outcome");
      Reflect.deleteProperty(task, "notBefore");
      Reflect.deleteProperty(task, "blockingDecisionId");
      Reflect.deleteProperty(task, "activity");
      Reflect.deleteProperty(task, "verification");
      item.arrange();
      expect(deriveSupervisorTaskStatus(run, task, NOW)).toBe(item.expected);
    }
  });

  test("does not treat pre-dispatch verification facts as active review", () => {
    const run = createSupervisorRunFixture();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    task.verification = {
      verificationId: "verification-task-a",
      status: "not_started",
      evidenceRefs: [],
    };

    expect(deriveSupervisorTaskStatus(run, task, NOW)).toBe("ready");
  });
});

function unapprovedPlan(): NonNullable<SupervisorRunState["plan"]> {
  return {
    version: 1,
    hash: "a".repeat(64),
    summary: "Awaiting approval",
    envelope: {
      goal: "Test goal",
      fileScopes: [],
      verificationCommands: [],
      successCriteria: ["Projection remains deterministic"],
      permissionScopes: [],
      destructiveActions: [],
      delivery: {
        createCommit: true,
        targetBranch: "main",
        targetHead: "abc123",
        allowDefaultBranch: false,
      },
    },
  };
}
