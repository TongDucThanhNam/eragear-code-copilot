import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import {
  countActionableSupervisorDecisions,
  getDirectRepositoryBlocker,
  getGoalIntakeRefetchInterval,
  getSupervisorCancellationNotice,
  getSupervisorCancellationPresentation,
  getSupervisorRunTitle,
  selectMissionControlProjectItems,
  selectMissionControlRuns,
} from "./mission-control-utils";

function runFixture(
  status: SupervisorRunClientUpdate["status"],
  title = "Build the demo"
): SupervisorRunClientUpdate {
  return {
    runId: `run-${status}`,
    revision: 1,
    status,
    priority: "normal",
    tasks: title
      ? [
          {
            taskId: "T1",
            title,
            role: "implementation",
            executionMode: "write",
            dependencies: [],
            status: status === "completed" ? "completed" : "needs_user",
            attempts: [],
          },
        ]
      : [],
    gates: [],
    capacityWaits: [],
    decisions: [
      {
        decisionId: "decision-1",
        kind: "worker_failure",
        status: "open",
        prompt: "Inspect the failure",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
    ],
    finalVerification: [],
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("Mission Control run presentation", () => {
  test("polls Goal Intake only while the server reports active reasoning", () => {
    expect(getGoalIntakeRefetchInterval(undefined)).toBe(false);
    expect(
      getGoalIntakeRefetchInterval([
        { reasoningState: "idle" },
        { reasoningState: "resumable" },
      ])
    ).toBe(false);
    expect(
      getGoalIntakeRefetchInterval([
        { reasoningState: "resumable" },
        { reasoningState: "active" },
      ])
    ).toBe(1000);
  });

  test("fails closed to the active project for goals, counts, and actions", () => {
    const projectOne = runFixture("running", "Project one goal");
    projectOne.projectId = "project-1";
    const projectTwo = runFixture("queued", "Project two goal");
    projectTwo.projectId = "project-2";
    const unownedLegacyRun = runFixture("planning", "Legacy goal");

    expect(
      selectMissionControlProjectItems(
        [projectOne, projectTwo, unownedLegacyRun],
        "project-1"
      ).map((run) => run.tasks[0]?.title)
    ).toEqual(["Project one goal"]);
    expect(
      selectMissionControlProjectItems([projectOne, projectTwo], null)
    ).toEqual([]);
  });

  test("separates live work from terminal history", () => {
    const runs = [runFixture("running"), runFixture("cancelled")];
    expect(
      selectMissionControlRuns(runs, "active").map((run) => run.status)
    ).toEqual(["running"]);
    expect(
      selectMissionControlRuns(runs, "history").map((run) => run.status)
    ).toEqual(["cancelled"]);
  });

  test("does not count stale decisions from terminal runs", () => {
    expect(
      countActionableSupervisorDecisions([
        runFixture("needs_user"),
        runFixture("cancelled"),
        runFixture("failed"),
      ])
    ).toBe(1);
  });

  test("distinguishes durable cancellation cleanup from a terminal cancellation", () => {
    const cancelling = runFixture("paused");
    cancelling.cancellation = {
      status: "running",
      pendingSessionCount: 2,
      pendingWorkspaceCount: 1,
    };
    expect(getSupervisorCancellationPresentation(cancelling)).toEqual({
      badgeLabel: "cancelling",
      actionLabel: "Continue cancellation",
      canRetry: true,
      requiresAttention: false,
      message:
        "Cancellation is durable. Supervisos is finishing 2 sessions and 1 workspace before this goal moves to History. Repeating the request is safe.",
    });

    cancelling.cancellation.status = "failed";
    expect(getSupervisorCancellationPresentation(cancelling)).toEqual({
      badgeLabel: "cancellation blocked",
      actionLabel: "Retry cancellation",
      canRetry: true,
      requiresAttention: true,
      message:
        "Cancellation cleanup failed with 2 sessions and 1 workspace still pending. Retry to create a new durable cleanup attempt.",
    });

    const terminal = runFixture("cancelled");
    terminal.cancellation = {
      status: "succeeded",
      pendingSessionCount: 0,
      pendingWorkspaceCount: 0,
    };
    expect(getSupervisorCancellationPresentation(terminal)).toBeUndefined();
  });

  test("claims cancellation success only for the durable terminal projection", () => {
    const requested = runFixture("paused");
    requested.cancellation = {
      status: "running",
      pendingSessionCount: 1,
      pendingWorkspaceCount: 0,
    };
    expect(getSupervisorCancellationNotice(requested)).toEqual({
      kind: "info",
      message: "Cancellation requested. Durable cleanup is still running.",
    });
    requested.cancellation.status = "failed";
    expect(getSupervisorCancellationNotice(requested)).toEqual({
      kind: "error",
      message: "Cancellation cleanup failed. Retry cancellation.",
    });
    expect(getSupervisorCancellationNotice(runFixture("cancelled"))).toEqual({
      kind: "success",
      message: "Supervisor run cancelled",
    });
  });

  test("prefers a human task title and supplies a planning fallback", () => {
    expect(
      getSupervisorRunTitle(runFixture("running", "AERIFORM visual QA"))
    ).toBe("AERIFORM visual QA");
    expect(getSupervisorRunTitle(runFixture("planning", ""))).toBe(
      "Manager is planning this goal"
    );
  });

  test("explains when a queued writer is behind a direct repository owner", () => {
    const queued = runFixture("queued", "MiniMax visual pass");
    queued.projectId = "lab";
    const queuedTask = queued.tasks[0];
    const owner = runFixture("waiting_capacity", "GLM visual pass");
    owner.projectId = "lab";
    const ownerTask = owner.tasks[0];
    if (!(queuedTask && ownerTask)) {
      throw new Error("Expected write task fixtures");
    }
    queuedTask.status = "ready";
    ownerTask.status = "waiting_capacity";
    ownerTask.attempts.push({
      attemptId: "attempt-1",
      chatId: "chat-1",
      agentId: "glm",
      status: "waiting_capacity",
      verification: [],
    });

    expect(getDirectRepositoryBlocker(queued, [queued, owner])).toBe(owner);
    owner.projectId = "another-project";
    expect(getDirectRepositoryBlocker(queued, [queued, owner])).toBeUndefined();
  });
});
