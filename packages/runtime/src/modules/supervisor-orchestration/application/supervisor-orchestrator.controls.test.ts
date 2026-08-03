import { describe, expect, test } from "bun:test";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerSessionManagerPort } from "./ports/worker-session-manager.port";
import type { WorkerWorkspacePort } from "./ports/worker-workspace.port";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import { WorkerResultService } from "./worker-result.service";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private readonly runs = new Map<string, SupervisorRunState>();

  constructor(run?: SupervisorRunState) {
    if (run) {
      this.runs.set(run.runId, structuredClone(run));
    }
  }

  create(run: SupervisorRunState): Promise<SupervisorRunState> {
    this.runs.set(run.runId, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }

  get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(
      run?.userId === userId ? structuredClone(run) : null
    );
  }

  list(input: { userId: string }): Promise<SupervisorRunState[]> {
    return Promise.resolve(
      [...this.runs.values()]
        .filter((run) => run.userId === input.userId)
        .map((run) => structuredClone(run))
    );
  }

  listNonTerminal(): Promise<SupervisorRunState[]> {
    return Promise.resolve(
      [...this.runs.values()].map((run) => structuredClone(run))
    );
  }

  save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState> {
    const current = this.runs.get(run.runId);
    if (current?.revision !== expectedRevision) {
      return Promise.reject(
        new SupervisorRunRevisionConflictError(
          run.runId,
          expectedRevision,
          current?.revision ?? -1
        )
      );
    }
    this.runs.set(run.runId, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }
}

function createTask(
  taskId: string,
  overrides: Partial<SupervisorTaskRecord> = {}
): SupervisorTaskRecord {
  const base = createSupervisorRunFixture().tasks[0];
  if (!base) {
    throw new Error("Task fixture missing");
  }
  return {
    ...base,
    taskId,
    title: taskId,
    goal: `Complete ${taskId}`,
    preferredAgentId: "agent-1",
    dependencies: [],
    status: "ready",
    ...overrides,
  };
}

function createHarness(
  run?: SupervisorRunState,
  options: { replanTasks?: SupervisorTaskRecord[] } = {}
) {
  const runs = new MemoryRuns(run);
  const dispatched: string[] = [];
  const stopped: string[] = [];
  const workers = {
    dispatch(input: { taskId: string }) {
      dispatched.push(input.taskId);
      return Promise.resolve({
        alreadyDispatched: false,
        attempt: {
          attemptId: `attempt-${input.taskId}`,
          chatId: `chat-${input.taskId}`,
          agentId: "agent-1",
          status: "running",
          idempotencyKey: `key-${input.taskId}`,
          startedAt: "2026-07-11T00:00:00.000Z",
        },
      });
    },
    stop(input: { attemptId: string }) {
      stopped.push(input.attemptId);
      return Promise.resolve();
    },
  } as unknown as WorkerSessionManagerPort;
  let id = 0;
  const service = new SupervisorOrchestratorService({
    runs,
    planner: {
      plan() {
        return Promise.resolve({
          proposal: { schemaVersion: 1, summary: "safe", tasks: [] },
          tasks: [createTask("task-a"), createTask("task-b")],
        });
      },
      replan() {
        if (!options.replanTasks) {
          throw new Error("not used");
        }
        return Promise.resolve({
          proposal: { schemaVersion: 1, summary: "replanned", tasks: [] },
          tasks: options.replanTasks,
        });
      },
    },
    scheduler: new SupervisorSchedulerService(),
    workers,
    agents: {
      listEligible() {
        return Promise.resolve([
          {
            agentId: "agent-1",
            displayName: "Agent",
            active: true,
            roles: [
              "research",
              "implementation",
              "test",
              "review",
              "integration",
            ],
          },
        ]);
      },
    },
    baseSnapshot: {
      capture() {
        return Promise.resolve({
          head: "abc123",
          dirtyPaths: [],
          targetFingerprints: {},
          capturedAt: "2026-07-11T00:00:00.000Z",
        });
      },
    },
    workspaces: {
      prepare(input: Parameters<WorkerWorkspacePort["prepare"]>[0]) {
        return Promise.resolve({
          workspaceId: `workspace-${input.taskId}`,
          kind: input.executionMode === "write" ? "isolated_git" : "read_only",
          userProjectRoot: input.projectRoot,
          projectRoot:
            input.executionMode === "write"
              ? `${input.projectRoot}/.isolated/${input.taskId}`
              : input.projectRoot,
          ...(input.baseSnapshot.head
            ? { baseHead: input.baseSnapshot.head }
            : {}),
          targetFingerprints: {},
        });
      },
      dispose() {
        return Promise.resolve();
      },
    } as never,
    integration: {
      integrate() {
        return Promise.resolve({ decision: "allow" as const, reasons: [] });
      },
    },
    results: new WorkerResultService(),
    finalVerifier: {
      verify() {
        return Promise.resolve([]);
      },
    },
    now: () => "2026-07-11T00:01:00.000Z",
    createId(prefix) {
      id += 1;
      return `${prefix}-${id}`;
    },
  });
  return { service, runs, dispatched, stopped };
}

describe("SupervisorOrchestratorService controls", () => {
  test("starts a run and dispatches two independent tasks within concurrency", async () => {
    const harness = createHarness();
    const run = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the feature",
    });
    expect(run.status).toBe("queued");
    expect(run.tasks.map((task) => task.status)).toEqual(["queued", "queued"]);
    expect(harness.dispatched).toEqual(["task-a", "task-b"]);
    expect(run.audit.map((entry) => entry.kind)).toEqual([
      "run_created",
      "plan_accepted",
    ]);
  });

  test("checks provider admission before every scheduled worker dispatch", async () => {
    const harness = createHarness();
    const admitted: string[] = [];
    harness.service.setDispatchAdmission({
      admit(input) {
        admitted.push(input.taskId);
        return Promise.resolve({ eligible: true });
      },
    });

    const run = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the scheduled feature",
      scheduleId: "schedule-1",
      providerId: "zai-coding-plan",
      eligibleAgentIds: ["agent-1"],
      workerModelId: "glm-zai",
    });

    expect(admitted).toEqual(["task-a", "task-b"]);
    expect(harness.dispatched).toEqual(["task-a", "task-b"]);
    expect(run).toMatchObject({
      scheduleId: "schedule-1",
      providerId: "zai-coding-plan",
      eligibleAgentIds: ["agent-1"],
      workerModelId: "glm-zai",
    });
  });

  test("leaves scheduled work queued when provider admission fails closed", async () => {
    const harness = createHarness();
    harness.service.setDispatchAdmission({
      admit() {
        return Promise.resolve({
          eligible: false,
          reason: "Quota snapshot is stale.",
          nextCheckAt: Date.parse("2026-07-11T00:02:00.000Z"),
        });
      },
    });

    const run = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the scheduled feature",
      scheduleId: "schedule-1",
      providerId: "zai-coding-plan",
    });

    expect(harness.dispatched).toEqual([]);
    expect(run.status).toBe("queued");
    expect(run.tasks.map((task) => task.status)).toEqual(["ready", "ready"]);
  });

  test("pauses without dispatch and resumes scheduling deterministically", async () => {
    const base = createSupervisorRunFixture({
      status: "running",
      tasks: [createTask("task-a")],
    });
    const harness = createHarness(base);
    const paused = await harness.service.pause(base.runId, base.userId);
    expect(paused.status).toBe("paused");
    expect(harness.dispatched).toEqual([]);
    const resumed = await harness.service.resume(base.runId, base.userId);
    expect(resumed.tasks[0]?.status).toBe("queued");
    expect(harness.dispatched).toEqual(["task-a"]);
  });

  test("cancels every active worker and all non-completed tasks", async () => {
    const activeTask = createTask("task-a", {
      status: "running",
      attempts: [
        {
          attemptId: "attempt-1",
          chatId: "chat-1",
          agentId: "agent-1",
          status: "running",
          idempotencyKey: "run:task:1",
          startedAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });
    const completedTask = createTask("task-b", { status: "completed" });
    const base = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask, completedTask],
    });
    const harness = createHarness(base);
    const cancelled = await harness.service.cancel(base.runId, base.userId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.tasks.map((task) => task.status)).toEqual([
      "cancelled",
      "completed",
    ]);
    expect(harness.stopped).toEqual(["attempt-1"]);
  });

  test("retries failed work within budget and rejects exhausted attempts", async () => {
    const failed = createTask("task-a", {
      status: "failed",
      attempts: [
        {
          attemptId: "attempt-1",
          chatId: "chat-1",
          agentId: "agent-1",
          status: "interrupted",
          idempotencyKey: "run:task:1",
          startedAt: "2026-07-11T00:00:00.000Z",
          finishedAt: "2026-07-11T00:00:30.000Z",
        },
      ],
    });
    const base = createSupervisorRunFixture({
      status: "needs_user",
      tasks: [failed],
    });
    const harness = createHarness(base);
    const retried = await harness.service.retryTask({
      runId: base.runId,
      userId: base.userId,
      taskId: failed.taskId,
    });
    expect(retried.tasks[0]?.status).toBe("queued");
    expect(harness.dispatched).toEqual(["task-a"]);

    const exhausted = createSupervisorRunFixture({
      status: "needs_user",
      limits: { ...base.limits, maxAttemptsPerTask: 1 },
      tasks: [failed],
    });
    await expect(
      createHarness(exhausted).service.retryTask({
        runId: exhausted.runId,
        userId: exhausted.userId,
        taskId: failed.taskId,
      })
    ).rejects.toThrow("exhausted its attempt budget");
  });

  test("rejects invalid transitions and cross-user access", async () => {
    const completed = createSupervisorRunFixture({ status: "completed" });
    const harness = createHarness(completed);
    await expect(
      harness.service.pause(completed.runId, completed.userId)
    ).rejects.toThrow("cannot be paused");
    await expect(
      harness.service.cancel(completed.runId, completed.userId)
    ).rejects.toThrow("cannot be cancelled");
    expect(await harness.service.get(completed.runId, "other-user")).toBeNull();
  });

  test("approves eligible gates, rejects gates, and prevents duplicate decisions", async () => {
    const task = createTask("task-a", {
      status: "needs_user",
      attempts: [
        {
          attemptId: "attempt-1",
          chatId: "chat-1",
          agentId: "agent-1",
          status: "terminal",
          idempotencyKey: "run:task:1",
          startedAt: "2026-07-11T00:00:00.000Z",
          finishedAt: "2026-07-11T00:00:30.000Z",
          workspace: {
            workspaceId: "workspace-1",
            kind: "isolated_git",
            userProjectRoot: "C:/repo",
            projectRoot: "C:/runtime/worktree-1",
            baseHead: "abc123",
            targetFingerprints: {},
          },
          result: {
            semanticStatus: "succeeded",
            reason: "done",
            outcomeSummary: "done",
            files: {
              touched: ["src/a.ts"],
              created: [],
              deleted: [],
              renamed: [],
            },
            verification: [
              {
                command: "bun test",
                exitCode: 0,
                outputSummary: "passed",
                startedAt: "2026-07-11T00:00:10.000Z",
                finishedAt: "2026-07-11T00:00:20.000Z",
              },
            ],
            patch: {
              artifactId: "patch-1",
              sha256: "a".repeat(64),
              byteLength: 12,
              storageRef: "C:/runtime/patch-1",
            },
            toolFailureSummary: [],
            unresolvedPermissions: [],
            agentId: "agent-1",
            chatId: "chat-1",
            startedAt: "2026-07-11T00:00:00.000Z",
            finishedAt: "2026-07-11T00:00:30.000Z",
          },
        },
      ],
    });
    const base = createSupervisorRunFixture({
      status: "needs_user",
      tasks: [task],
      gates: [
        {
          gateId: "gate-1",
          taskId: task.taskId,
          attemptId: "attempt-1",
          kind: "scope",
          status: "pending",
          reason: "scope_drift",
          createdAt: "2026-07-11T00:00:30.000Z",
        },
      ],
    });
    const approvedHarness = createHarness(base);
    const approved = await approvedHarness.service.approveGate({
      runId: base.runId,
      userId: base.userId,
      gateId: "gate-1",
    });
    expect(approved.gates[0]?.status).toBe("approved");
    expect(approved.tasks[0]?.status).toBe("completed");
    await expect(
      approvedHarness.service.approveGate({
        runId: base.runId,
        userId: base.userId,
        gateId: "gate-1",
      })
    ).rejects.toThrow("already approved");

    const rejectedHarness = createHarness(base);
    const rejected = await rejectedHarness.service.rejectGate({
      runId: base.runId,
      userId: base.userId,
      gateId: "gate-1",
    });
    expect(rejected.gates[0]?.status).toBe("rejected");
    expect(rejected.tasks[0]?.status).toBe("failed");
  });

  test("replans within budget and rejects active or exhausted runs", async () => {
    const failedTask = createTask("task-a", { status: "failed" });
    const replacement = createTask("task-b");
    const base = createSupervisorRunFixture({
      status: "needs_user",
      tasks: [failedTask],
    });
    const harness = createHarness(base, { replanTasks: [replacement] });
    const replanned = await harness.service.replan(base.runId, base.userId);
    expect(replanned.plannerReplanCount).toBe(1);
    expect(replanned.tasks[0]?.taskId).toBe("task-b");
    expect(harness.dispatched).toEqual(["task-b"]);

    const active = createSupervisorRunFixture({
      status: "running",
      tasks: [
        createTask("task-a", {
          status: "running",
          attempts: [
            {
              attemptId: "attempt-active",
              chatId: "chat-active",
              agentId: "agent-1",
              status: "running",
              idempotencyKey: "active-key",
              startedAt: "2026-07-11T00:00:00.000Z",
            },
          ],
        }),
      ],
    });
    await expect(
      createHarness(active, { replanTasks: [replacement] }).service.replan(
        active.runId,
        active.userId
      )
    ).rejects.toThrow("Active workers");

    const exhausted = createSupervisorRunFixture({
      status: "needs_user",
      plannerReplanCount: 2,
      tasks: [failedTask],
    });
    await expect(
      createHarness(exhausted, {
        replanTasks: [replacement],
      }).service.replan(exhausted.runId, exhausted.userId)
    ).rejects.toThrow("exhausted its replan budget");
  });
});
