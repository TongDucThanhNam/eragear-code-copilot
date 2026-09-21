import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";
import {
  deriveReadyTaskIds,
  InvalidSupervisorRunTransitionError,
  recomputeSupervisorTaskReadiness,
  SupervisorRunRevisionConflictError,
  setSupervisorRunStatus,
  setSupervisorTaskStatus,
  transitionSupervisorRun,
} from "./supervisor-run.transitions";

const LATER = "2026-07-11T00:01:00.000Z";

describe("supervisor run transitions", () => {
  test("increments revision exactly once and enforces expected revision", () => {
    const current = createSupervisorRunFixture();
    const next = transitionSupervisorRun(current, {
      expectedRevision: 0,
      now: LATER,
      mutate(draft) {
        setSupervisorRunStatus(draft, "running");
        setSupervisorTaskStatus(draft, "task-a", "queued");
      },
    });
    expect(next.revision).toBe(1);
    expect(next.updatedAt).toBe(LATER);
    expect(next.status).toBe("running");
    expect(next.tasks[0]?.status).toBe("queued");
    expect(() =>
      transitionSupervisorRun(next, {
        expectedRevision: 0,
        now: LATER,
        mutate() {
          // Intentionally empty: the stale expected revision is the behavior under test.
        },
      })
    ).toThrow(SupervisorRunRevisionConflictError);
  });

  test("rejects terminal run reopening and ownership mutation", () => {
    const completed = createSupervisorRunFixture({ status: "completed" });
    expect(() =>
      transitionSupervisorRun(completed, {
        expectedRevision: 0,
        now: LATER,
        mutate(draft) {
          draft.status = "running";
        },
      })
    ).toThrow(InvalidSupervisorRunTransitionError);
    expect(() =>
      transitionSupervisorRun(createSupervisorRunFixture(), {
        expectedRevision: 0,
        now: LATER,
        mutate(draft) {
          draft.userId = "other-user";
        },
      })
    ).toThrow(InvalidSupervisorRunTransitionError);
  });

  test("allows an in-envelope replan to move directly from planning to queued", () => {
    const planning = createSupervisorRunFixture({ status: "planning" });
    const queued = transitionSupervisorRun(planning, {
      expectedRevision: planning.revision,
      now: LATER,
      mutate(draft) {
        draft.status = "queued";
      },
    });
    expect(queued.status).toBe("queued");
  });

  test("derives dependency readiness and never removes completed work", () => {
    const run = createSupervisorRunFixture();
    expect(deriveReadyTaskIds(run)).toEqual(["task-a"]);
    const [firstTask, secondTask] = run.tasks;
    if (!(firstTask && secondTask)) {
      throw new Error("Fixture must contain two tasks");
    }
    const withCompletedDependency = {
      ...run,
      tasks: [
        {
          ...firstTask,
          outcome: "succeeded" as const,
          status: "completed" as const,
        },
        secondTask,
      ],
    };
    expect(deriveReadyTaskIds(withCompletedDependency)).toEqual(["task-b"]);
    recomputeSupervisorTaskReadiness(withCompletedDependency, LATER);
    expect(withCompletedDependency.tasks[1]?.status).toBe("ready");
    expect(() =>
      transitionSupervisorRun(withCompletedDependency, {
        expectedRevision: 0,
        now: LATER,
        mutate(draft) {
          draft.tasks = draft.tasks.filter((task) => task.taskId !== "task-a");
        },
      })
    ).toThrow(InvalidSupervisorRunTransitionError);
  });

  test("projects new lifecycle facts and translates legacy status writes", () => {
    const current = createSupervisorRunFixture();
    const paused = transitionSupervisorRun(current, {
      expectedRevision: current.revision,
      now: LATER,
      mutate(draft) {
        draft.desiredState = "paused";
      },
    });
    expect(paused.status).toBe("paused");
    expect(paused.phase).toBe("executing");

    const legacyRunning = transitionSupervisorRun(current, {
      expectedRevision: current.revision,
      now: LATER,
      mutate(draft) {
        draft.status = "running";
      },
    });
    expect(legacyRunning.desiredState).toBe("running");
    expect(legacyRunning.phase).toBe("executing");
    expect(legacyRunning.activity).toBe("executing");
    expect(legacyRunning.status).toBe("running");
  });

  test("materializes a durable decision for a legacy needs-user mutation", () => {
    const current = createSupervisorRunFixture();
    const blocked = transitionSupervisorRun(current, {
      expectedRevision: current.revision,
      now: LATER,
      mutate(draft) {
        draft.status = "needs_user";
        const task = draft.tasks[0];
        if (!task) {
          throw new Error("Fixture task missing");
        }
        task.status = "needs_user";
      },
    });

    expect(blocked.blockingDecisionId).toBeDefined();
    expect(blocked.tasks[0]?.blockingDecisionId).toBeDefined();
    expect(blocked.decisions).toHaveLength(2);
    expect(
      blocked.decisions.every((decision) => decision.status === "open")
    ).toBeTrue();
  });

  test("projects a stale V3 compatibility status from terminal facts", () => {
    const stale = createSupervisorRunFixture({ status: "completed" });
    stale.status = "running";

    const next = transitionSupervisorRun(stale, {
      expectedRevision: stale.revision,
      now: LATER,
      mutate() {
        // A no-op transition must not translate stale compatibility data to facts.
      },
    });

    expect(next.status).toBe("completed");
    expect(next.phase).toBe("finished");
    expect(next.outcome).toBe("succeeded");
  });

  test("allows an elapsed not-before work item to move directly into dispatch", () => {
    const deferred = createSupervisorRunFixture();
    const task = deferred.tasks[0];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    task.notBefore = "2026-07-11T00:00:30.000Z";
    task.status = "blocked";

    const queued = transitionSupervisorRun(deferred, {
      expectedRevision: deferred.revision,
      now: LATER,
      mutate(draft) {
        const draftTask = draft.tasks[0];
        if (!draftTask) {
          throw new Error("Fixture task missing");
        }
        draftTask.status = "queued";
      },
    });

    expect(queued.tasks[0]?.status).toBe("queued");
    expect(queued.tasks[0]?.notBefore).toBeUndefined();
  });

  test("allows fact projections to skip legacy task presentation states", () => {
    const current = createSupervisorRunFixture();
    const waiting = transitionSupervisorRun(current, {
      expectedRevision: current.revision,
      now: LATER,
      mutate(draft) {
        const task = draft.tasks[0];
        if (!task) {
          throw new Error("Fixture task missing");
        }
        task.dispatch = {
          dispatchId: "dispatch-1",
          state: "capacity_requested",
        };
        task.activity = "dispatching";
      },
    });

    expect(waiting.tasks[0]?.status).toBe("waiting_capacity");

    const leased = transitionSupervisorRun(waiting, {
      expectedRevision: waiting.revision,
      now: LATER,
      mutate(draft) {
        const task = draft.tasks[0];
        if (!task) {
          throw new Error("Fixture task missing");
        }
        task.preferredAgentId = "agent-1";
        task.dispatch = { dispatchId: "dispatch-1", state: "leased" };
        task.capacityLease = {
          leaseId: "lease-1",
          agentIdentityId: "agent-1",
          issuedAt: LATER,
          expiresAt: "2026-07-11T00:02:00.000Z",
        };
      },
    });

    expect(leased.tasks[0]?.status).toBe("queued");
  });
});
