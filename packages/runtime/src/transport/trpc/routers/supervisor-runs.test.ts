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
          createDraft: (input: { userId: string }) =>
            returnRun("createDraft", input.userId),
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
          approvePlan: (input: { userId: string }) =>
            returnRun("approvePlan", input.userId),
          requestPlanChanges: (input: { userId: string }) =>
            returnRun("requestPlanChanges", input.userId),
          answerDecision: (input: { userId: string }) =>
            returnRun("answerDecision", input.userId),
          setPriority: (input: { userId: string }) =>
            returnRun("setPriority", input.userId),
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
  return { caller, calls, run };
}

describe("supervisorRunsRouter", () => {
  test("exposes the complete typed control and update surface", () => {
    const procedures = supervisorRunsRouter._def.procedures as Record<
      string,
      unknown
    >;
    for (const name of [
      "start",
      "createDraft",
      "get",
      "detail",
      "list",
      "pause",
      "resume",
      "cancel",
      "replan",
      "approvePlan",
      "requestPlanChanges",
      "answerDecision",
      "setPriority",
      "retryTask",
      "approveGate",
      "rejectGate",
      "updates",
      "profiles.list",
      "profiles.upsert",
      "profiles.testResume",
      "inbox.list",
      "inbox.updates",
      "telegram.status",
      "telegram.configure",
      "telegram.beginPairing",
    ]) {
      expect(procedures[name]).toBeDefined();
    }
  });

  test("injects authenticated ownership into every operation", async () => {
    const { caller, calls } = createCaller();
    await caller.start({
      projectId: "project-1",
      intent: "Implement safely",
    });
    await caller.createDraft({
      projectId: "project-1",
      intent: "Implement safely",
    });
    await caller.get({ runId: "run-1" });
    await caller.detail({ runId: "run-1" });
    await caller.list();
    await caller.pause({ runId: "run-1" });
    await caller.resume({ runId: "run-1" });
    await caller.cancel({ runId: "run-1" });
    await caller.replan({ runId: "run-1" });
    await caller.approvePlan({
      runId: "run-1",
      planVersion: 1,
      planHash: "a".repeat(64),
      expectedRevision: 0,
    });
    await caller.requestPlanChanges({
      runId: "run-1",
      requestedChanges: "Narrow scope",
      expectedRevision: 0,
    });
    await caller.answerDecision({
      runId: "run-1",
      decisionId: "decision-1",
      answer: "Use option A",
      expectedRevision: 0,
    });
    await caller.setPriority({
      runId: "run-1",
      priority: "high",
      expectedRevision: 0,
    });
    await caller.retryTask({ runId: "run-1", taskId: "task-1" });
    await caller.approveGate({ runId: "run-1", gateId: "gate-1" });
    await caller.rejectGate({ runId: "run-1", gateId: "gate-1" });

    expect(calls).toHaveLength(16);
    expect(calls.every((call) => call.userId === "user-1")).toBe(true);
  });

  test("maps the read-only detail projection through authenticated ownership", async () => {
    const { caller, run } = createCaller();
    const detail = await caller.detail({ runId: run.runId });
    expect(detail).not.toBeNull();
    expect(detail?.runId).toBe(run.runId);
    expect(detail?.tasks[0]?.prompt).toBe("Find the relevant interfaces");
    const other = supervisorRunsRouter.createCaller({
      auth: { type: "local", userId: "user-2" },
      appConfig: {},
      useCases: {
        project: {
          list: {
            execute: () =>
              Promise.resolve({ projects: [], activeProjectId: null }),
          },
        },
        supervisorOrchestration: {
          orchestrator: {
            get: () => Promise.resolve(null),
          },
          events: { subscribe: () => () => undefined },
        },
      },
    } as never);
    await expect(other.detail({ runId: run.runId })).resolves.toBeNull();
  });

  test("resolves project root server-side and rejects an unknown project", async () => {
    const { caller } = createCaller();
    await expect(
      caller.createDraft({
        projectId: "missing-project",
        intent: "Cross project attempt",
      })
    ).rejects.toThrow("Project not found or does not belong to the user");
  });

  test("returns durable cancellation progress instead of claiming a terminal outcome", async () => {
    const { caller, run } = createCaller();
    run.status = "paused";
    run.desiredState = "cancelled";
    run.cancellation = {
      status: "running",
      pendingSessionIds: ["private-session"],
      pendingWorkspaceIds: ["private-workspace"],
    };

    const update = await caller.cancel({ runId: run.runId });

    expect(update.status).toBe("paused");
    expect(update.cancellation).toEqual({
      status: "running",
      pendingSessionCount: 1,
      pendingWorkspaceCount: 1,
    });
    expect(JSON.stringify(update)).not.toContain("private-session");
    expect(JSON.stringify(update)).not.toContain("private-workspace");
  });
});
