import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "#runtime/modules/supervisor-orchestration/domain/supervisor-run.test-fixture";
import { supervisorRunsRouter } from "./supervisor-runs";

function createCaller(userId = "user-1") {
  const calls: Array<{ method: string; userId: string }> = [];
  const run = createSupervisorRunFixture({ userId, projectId: "project-1" });
  const returnRun = (method: string, owner: string) => {
    calls.push({ method, userId: owner });
    return Promise.resolve(run);
  };
  const caller = supervisorRunsRouter.createCaller({
    auth: { type: "local", userId },
    appConfig: {},
    useCases: {
      project: {
        list: {
          execute: () =>
            Promise.resolve({
              projects: [{ id: "project-1", path: "C:/repo" }],
              activeProjectId: "project-1",
            }),
        },
      },
      supervisorOrchestration: {
        orchestrator: {
          start: (input: { userId: string }) =>
            returnRun("start", input.userId),
          get: (_runId: string, owner: string) => {
            calls.push({ method: "get", userId: owner });
            return Promise.resolve(owner === userId ? run : null);
          },
          list: (input: { userId: string }) => {
            calls.push({ method: "list", userId: input.userId });
            return Promise.resolve([run]);
          },
          pause: (_runId: string, owner: string) => returnRun("pause", owner),
          resume: (_runId: string, owner: string) => returnRun("resume", owner),
          cancel: (_runId: string, owner: string) => returnRun("cancel", owner),
          replan: (_runId: string, owner: string) => returnRun("replan", owner),
          retryTask: (input: { userId: string }) =>
            returnRun("retryTask", input.userId),
          approveGate: (input: { userId: string }) =>
            returnRun("approveGate", input.userId),
          rejectGate: (input: { userId: string }) =>
            returnRun("rejectGate", input.userId),
        },
        events: { subscribe: () => () => undefined },
      },
    },
  } as never);
  return { caller, calls };
}

describe("supervisorRunsRouter", () => {
  test("exposes the complete typed control and update surface", () => {
    const procedures = supervisorRunsRouter._def.procedures as Record<
      string,
      unknown
    >;
    for (const name of [
      "start",
      "get",
      "list",
      "pause",
      "resume",
      "cancel",
      "replan",
      "retryTask",
      "approveGate",
      "rejectGate",
      "updates",
    ]) {
      expect(procedures[name]).toBeDefined();
    }
  });

  test("injects authenticated ownership into every operation", async () => {
    const { caller, calls } = createCaller();
    await caller.start({
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement safely",
    });
    await caller.get({ runId: "run-1" });
    await caller.list();
    await caller.pause({ runId: "run-1" });
    await caller.resume({ runId: "run-1" });
    await caller.cancel({ runId: "run-1" });
    await caller.replan({ runId: "run-1" });
    await caller.retryTask({ runId: "run-1", taskId: "task-1" });
    await caller.approveGate({ runId: "run-1", gateId: "gate-1" });
    await caller.rejectGate({ runId: "run-1", gateId: "gate-1" });

    expect(calls).toHaveLength(10);
    expect(calls.every((call) => call.userId === "user-1")).toBe(true);
  });

  test("rejects a project root that is not owned by the authenticated project", async () => {
    const { caller } = createCaller();
    await expect(
      caller.start({
        projectId: "project-1",
        projectRoot: "C:/someone-else/repo",
        originalIntent: "Cross project attempt",
      })
    ).rejects.toThrow(
      "Project not found or project root does not match ownership"
    );
  });
});
