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

  test("derives dependency readiness and never removes completed work", () => {
    const run = createSupervisorRunFixture();
    expect(deriveReadyTaskIds(run)).toEqual(["task-a"]);
    const [firstTask, secondTask] = run.tasks;
    if (!(firstTask && secondTask)) {
      throw new Error("Fixture must contain two tasks");
    }
    const withCompletedDependency = {
      ...run,
      tasks: [{ ...firstTask, status: "completed" as const }, secondTask],
    };
    expect(deriveReadyTaskIds(withCompletedDependency)).toEqual(["task-b"]);
    recomputeSupervisorTaskReadiness(withCompletedDependency);
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
});
