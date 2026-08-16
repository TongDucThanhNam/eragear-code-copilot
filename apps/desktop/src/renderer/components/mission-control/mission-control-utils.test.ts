import { describe, expect, test } from "bun:test";
import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import {
  countActionableSupervisorDecisions,
  getDirectRepositoryBlocker,
  getSupervisorRunTitle,
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
