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
import {
  type SupervisorOrchestratorDeps,
  SupervisorOrchestratorService,
} from "./supervisor-orchestrator.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import type { SupervisorWorkflowRunBoundaryPort } from "./supervisor-workflow-run-boundary";
import { SupervisorWorkflowRunBoundary } from "./supervisor-workflow-run-boundary";
import { WorkerResultService } from "./worker-result.service";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private readonly runs = new Map<string, SupervisorRunState>();

  constructor(run?: SupervisorRunState) {
    if (run) {
      this.runs.set(run.runId, structuredClone(run));
    }
  }

  create(run: SupervisorRunState): Promise<SupervisorRunState> {
    const existing = this.runs.get(run.runId);
    if (existing) {
      return Promise.reject(
        new SupervisorRunRevisionConflictError(run.runId, -1, existing.revision)
      );
    }
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

function sourceGoalContractFixture(
  overrides: Partial<
    NonNullable<
      Parameters<
        SupervisorOrchestratorService["createDraft"]
      >[0]["sourceGoalContract"]
    >
  > = {}
) {
  return {
    intakeId: "goal-intake-1",
    revisionId: "goal-contract-1",
    revision: 1,
    hash: "a".repeat(64),
    createdAt: "2026-07-11T00:00:00.000Z",
    contract: {
      title: "Durable Goal Contract",
      objective: "Deliver the approved outcome",
      lockedStrategicDecisions: ["SQLite remains execution truth"],
      assumptions: [],
      nonGoals: [],
      changeBoundary: ["packages/runtime/**"],
      acceptanceCriteria: [
        {
          criterionId: "criterion-1",
          statement: "The approved outcome has durable evidence",
          evidence: "machine" as const,
        },
      ],
      trustedVerificationCommands: ["bun test"],
      authority: {
        scopedCodeChange: "auto" as const,
        architectureChange: "ask" as const,
        dependencyChange: "ask" as const,
        destructiveAction: "ask" as const,
        finalIntegration: "ask" as const,
      },
      unresolvedQuestions: [],
    },
    ...overrides,
  };
}

function createHarness(
  run?: SupervisorRunState,
  options: {
    replanTasks?: SupervisorTaskRecord[];
    manager?: SupervisorOrchestratorDeps["manager"];
    finalVerifier?: SupervisorOrchestratorDeps["finalVerifier"];
    finalCommit?: SupervisorOrchestratorDeps["finalCommit"];
    workspaces?: WorkerWorkspacePort;
    workflowRunBoundary?: SupervisorWorkflowRunBoundaryPort;
  } = {}
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
    release() {
      return Promise.resolve();
    },
  } as unknown as WorkerSessionManagerPort;
  let id = 0;
  const service = new SupervisorOrchestratorService({
    runs,
    ...(options.manager ? { manager: options.manager } : {}),
    planner: {
      plan() {
        return Promise.resolve({
          proposal: { schemaVersion: 1, summary: "safe", tasks: [] },
          tasks: [
            createTask("task-a", { criterionIds: ["criterion-1"] }),
            createTask("task-b"),
          ],
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
    workspaces:
      options.workspaces ??
      ({
        prepare(input: Parameters<WorkerWorkspacePort["prepare"]>[0]) {
          return Promise.resolve({
            workspaceId: `workspace-${input.taskId}`,
            kind:
              input.executionMode === "write" ? "isolated_git" : "read_only",
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
      } as never),
    integration: {
      integrate() {
        return Promise.resolve({ decision: "allow" as const, reasons: [] });
      },
    },
    results: new WorkerResultService(),
    finalVerifier: options.finalVerifier ?? {
      verify() {
        return Promise.resolve([]);
      },
    },
    ...(options.finalCommit ? { finalCommit: options.finalCommit } : {}),
    ...(options.workflowRunBoundary
      ? { workflowRunBoundary: options.workflowRunBoundary }
      : {}),
    now: () => "2026-07-11T00:01:00.000Z",
    createId(prefix) {
      id += 1;
      return `${prefix}-${id}`;
    },
  });
  return { service, runs, dispatched, stopped };
}

async function approveDraft(
  harness: ReturnType<typeof createHarness>,
  draft: SupervisorRunState
) {
  if (!draft.plan) {
    throw new Error("Expected a persisted plan proposal");
  }
  return await harness.service.approvePlan({
    runId: draft.runId,
    userId: draft.userId,
    planVersion: draft.plan.version,
    planHash: draft.plan.hash,
    expectedRevision: draft.revision,
  });
}

describe("SupervisorOrchestratorService controls", () => {
  test("binds one immutable Supervisor run to an approved Goal Intake contract", async () => {
    const harness = createHarness();
    const sourceGoalContract = sourceGoalContractFixture({
      intakeId: "goal-intake-1",
      revisionId: "goal-contract-1",
      hash: "a".repeat(64),
    });
    const created = await harness.service.createDraft({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      intent: "Deliver the approved outcome",
      constraints: ["Stay inside the approved boundary"],
      priority: "normal",
      sourceGoalContract,
    });

    const replayed = await harness.service.createDraft({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      intent: "This replay must not create another run",
      constraints: [],
      priority: "normal",
      sourceGoalContract,
    });

    expect(replayed.runId).toBe(created.runId);
    expect(replayed.sourceGoalContract).toEqual(sourceGoalContract);
    expect(replayed.workflowPlan?.goalRevisionId).toBe(
      sourceGoalContract.revisionId
    );
    expect(await harness.runs.list({ userId: "user-1" })).toHaveLength(1);

    await expect(
      harness.service.createDraft({
        userId: "user-1",
        projectId: "project-1",
        projectRoot: "C:/repo",
        intent: "Attempt to rotate the already-bound contract",
        constraints: [],
        priority: "normal",
        sourceGoalContract: {
          ...sourceGoalContract,
          hash: "b".repeat(64),
        },
      })
    ).rejects.toThrow("already bound to another contract revision");
  });

  test("concurrent exact Goal Contract conversion converges on one deterministic run", async () => {
    const harness = createHarness();
    const sourceGoalContract = sourceGoalContractFixture({
      intakeId: "goal-intake-concurrent",
      revisionId: "goal-contract-concurrent",
      hash: "c".repeat(64),
    });
    const input = {
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      intent: "Deliver the exact concurrent contract",
      constraints: ["Preserve its frozen provenance"],
      priority: "normal" as const,
      sourceGoalContract,
    };

    const [left, right] = await Promise.all([
      harness.service.createDraft(input),
      harness.service.createDraft(input),
    ]);

    expect(left.runId).toBe(right.runId);
    expect(left.runId).toStartWith("supervisor-run-goal-");
    expect(left.sourceGoalContract).toEqual(sourceGoalContract);
    expect(right.sourceGoalContract).toEqual(sourceGoalContract);
    expect(await harness.runs.list({ userId: "user-1" })).toHaveLength(1);
  });

  test("recovers the exact persisted source run after workflow pumping fails", async () => {
    const harness = createHarness();
    const sourceGoalContract = sourceGoalContractFixture({
      intakeId: "goal-intake-pump-failure",
      revisionId: "goal-contract-pump-failure",
      hash: "d".repeat(64),
    });
    const input = {
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      intent: "Preserve the run across a pump failure",
      constraints: ["Do not create a replacement run"],
      priority: "normal" as const,
      sourceGoalContract,
    };
    let pumpCalls = 0;
    harness.service.setWorkflowPump(async (runId, userId) => {
      pumpCalls += 1;
      if (pumpCalls === 1) {
        throw new Error("workflow pump failed after create");
      }
      const run = await harness.runs.get(runId, userId);
      if (!run) {
        throw new Error("Persisted source run disappeared before retry pump");
      }
      return run;
    });

    await expect(harness.service.createDraft(input)).rejects.toThrow(
      "workflow pump failed after create"
    );
    const persisted = (await harness.runs.list({ userId: "user-1" }))[0];
    if (!persisted) {
      throw new Error("Expected persisted source run after pump failure");
    }
    const replayed = await harness.service.createDraft(input);

    expect(replayed.runId).toBe(persisted.runId);
    expect(replayed.sourceGoalContract).toEqual(sourceGoalContract);
    expect(pumpCalls).toBe(2);
    expect(await harness.runs.list({ userId: "user-1" })).toHaveLength(1);
  });

  test("accepts cancellation only after in-flight effect IO and its result commit", async () => {
    const run = createSupervisorRunFixture({
      schemaVersion: 3,
      desiredState: "running",
      phase: "executing",
      status: "running",
      workflowPlan: {
        goalRevisionId: "goal-1",
        authorityId: "authority-1",
        status: "approved",
        planVersion: 1,
      },
    });
    const boundary = new SupervisorWorkflowRunBoundary();
    const harness = createHarness(run, { workflowRunBoundary: boundary });
    const entered = deferred<void>();
    const release = deferred<void>();
    const order: string[] = [];
    const effect = boundary.runExclusive(run.runId, async () => {
      order.push("integration-io-started");
      entered.resolve();
      await release.promise;
      order.push("integration-result-committed");
    });
    await entered.promise;

    let cancellationResolved = false;
    const cancellation = harness.service
      .cancel(run.runId, run.userId)
      .then((saved) => {
        cancellationResolved = true;
        order.push("cancellation-accepted");
        return saved;
      });
    await Promise.resolve();
    await Promise.resolve();

    expect(cancellationResolved).toBe(false);
    release.resolve();
    const [, cancelled] = await Promise.all([effect, cancellation]);
    expect(cancelled.desiredState).toBe("cancelled");
    expect(order).toEqual([
      "integration-io-started",
      "integration-result-committed",
      "cancellation-accepted",
    ]);
  });

  test("approves a run into durable ready work without direct dispatch", async () => {
    const harness = createHarness();
    const draft = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the feature",
    });
    expect(draft.status).toBe("awaiting_approval");
    expect(harness.dispatched).toEqual([]);
    const run = await approveDraft(harness, draft);
    expect(run.tasks.map((task) => task.status)).toEqual(["ready", "ready"]);
    expect(harness.dispatched).toEqual([]);
    expect(run.audit.map((entry) => entry.kind)).toEqual([
      "run_created",
      "plan_awaiting_approval",
      "plan_approved",
    ]);
  });

  test("defers provider admission to the durable capacity effect", async () => {
    const harness = createHarness();
    const admitted: string[] = [];
    harness.service.setDispatchAdmission({
      admit(input) {
        admitted.push(input.taskId);
        return Promise.resolve({ eligible: true });
      },
    });

    const draft = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the scheduled feature",
      scheduleId: "schedule-1",
      providerId: "zai-coding-plan",
      eligibleAgentIds: ["agent-1"],
      workerModelId: "glm-zai",
    });
    const run = await approveDraft(harness, draft);

    expect(admitted).toEqual([]);
    expect(harness.dispatched).toEqual([]);
    expect(run).toMatchObject({
      legacyAutomation: {
        scheduleId: "schedule-1",
        providerId: "zai-coding-plan",
        workerModelId: "glm-zai",
      },
      agentAllowlist: ["agent-1"],
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

    const draft = await harness.service.start({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:/repo",
      originalIntent: "Implement the scheduled feature",
      scheduleId: "schedule-1",
      providerId: "zai-coding-plan",
    });
    const run = await approveDraft(harness, draft);

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
    expect(resumed.tasks[0]?.status).toBe("ready");
    expect(harness.dispatched).toEqual([]);
  });

  test("persists cancellation intent before any worker cleanup", async () => {
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
    const capacityTask = createTask("task-capacity", {
      status: "waiting_capacity",
      attempts: [
        {
          attemptId: "attempt-capacity",
          chatId: "chat-capacity",
          agentId: "agent-1",
          status: "waiting_capacity",
          idempotencyKey: "run:task:capacity",
          startedAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });
    const completedTask = createTask("task-b", { status: "completed" });
    const base = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask, capacityTask, completedTask],
      capacityWaits: [
        {
          waitId: "wait-capacity",
          owner: "task",
          taskId: capacityTask.taskId,
          attemptId: "attempt-capacity",
          agentId: "agent-1",
          kind: "quota_exhausted",
          reason: "Quota resets later",
          suspendedAt: "2026-07-11T00:00:30.000Z",
          retryAt: "2026-07-11T01:00:00.000Z",
          backoffStep: 0,
        },
      ],
    });
    const harness = createHarness(base);
    const cancelled = await harness.service.cancel(base.runId, base.userId);
    expect(cancelled.status).toBe("paused");
    expect(cancelled.outcome).toBeUndefined();
    expect(cancelled.desiredState).toBe("cancelled");
    expect(cancelled.cancellation).toMatchObject({
      status: "pending",
      pendingSessionIds: ["chat-1", "chat-capacity"],
    });
    expect(
      cancelled.tasks.flatMap((task) =>
        task.attempts.map((attempt) => attempt.status)
      )
    ).toEqual(["running", "waiting_capacity"]);
    expect(harness.stopped).toEqual([]);
  });

  test("keeps cancellation durable while cleanup effects are pending", async () => {
    const workspace = {
      workspaceId: "workspace-cancel",
      kind: "isolated_git" as const,
      userProjectRoot: "C:/repo",
      projectRoot: "C:/runtime/workspace-cancel",
      gitWorktreeRoot: "C:/runtime/workspace-cancel",
      baseHead: "abc123",
      targetFingerprints: {},
    };
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
          workspace,
        },
      ],
    });
    const base = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask],
    });
    let interruptCleanup = true;
    const disposed: string[] = [];
    const harness = createHarness(base, {
      workspaces: {
        dispose(candidate: Parameters<WorkerWorkspacePort["dispose"]>[0]) {
          disposed.push(candidate.workspaceId);
          if (interruptCleanup) {
            interruptCleanup = false;
            return Promise.reject(new Error("simulated cancellation crash"));
          }
          return Promise.resolve();
        },
      } as unknown as WorkerWorkspacePort,
    });

    await harness.service.cancel(base.runId, base.userId);
    const cancelling = await harness.runs.get(base.runId, base.userId);
    if (!cancelling) {
      throw new Error("Expected durable cancellation state");
    }
    expect(cancelling).toMatchObject({
      status: "paused",
      desiredState: "cancelled",
      phase: "executing",
    });
    expect(cancelling.outcome).toBeUndefined();
    const stillCancelling = await harness.service.pause(
      base.runId,
      base.userId
    );
    expect(stillCancelling.desiredState).toBe("cancelled");
    await expect(
      harness.service.resume(base.runId, base.userId)
    ).rejects.toThrow("cancellation is still in progress");

    const stillPending = await harness.service.cancel(base.runId, base.userId);

    expect(stillPending).toMatchObject({
      status: "paused",
      desiredState: "cancelled",
      phase: "executing",
      cancellation: {
        status: "pending",
        pendingSessionIds: ["chat-1"],
        pendingWorkspaceIds: ["workspace-cancel"],
      },
    });
    expect(stillPending.revision).toBe(cancelling.revision);
    expect(stillPending.workflowPlan?.authorityId).toBe(
      cancelling.workflowPlan?.authorityId
    );
    expect(stillPending.tasks[0]?.attempts[0]?.status).toBe("running");
    expect(harness.stopped).toEqual([]);
    expect(disposed).toEqual([]);
  });

  test("records sticky manager cleanup as a cancellation effect", async () => {
    const base = createSupervisorRunFixture({
      status: "planning",
      tasks: [],
      managerSession: {
        agentId: "agent-1",
        chatId: "manager-chat-1",
        agentSessionId: "acp-1",
        status: "running",
        exactResumeRequired: true,
        activeTurn: {
          turnId: "turn-1",
          kind: "plan",
          startedAt: "2026-07-11T00:00:00.000Z",
        },
      },
    });
    const stoppedManagers: string[] = [];
    const harness = createHarness(base, {
      manager: {
        dispatch: () => Promise.reject(new Error("not used")),
        stop: (input) => {
          stoppedManagers.push(input.runId);
          return Promise.resolve(base);
        },
      },
    });

    const cancelled = await harness.service.cancel(base.runId, base.userId);
    expect(cancelled.status).toBe("paused");
    expect(cancelled.cancellation?.pendingSessionIds).toEqual([
      "manager-chat-1",
    ]);
    expect(stoppedManagers).toEqual([]);
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
    expect(retried.tasks[0]?.status).toBe("ready");
    expect(harness.dispatched).toEqual([]);

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

  test("keeps a retry queued while another direct writer owns the repository", async () => {
    const failed = createTask("task-a", {
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
        },
      ],
    });
    const base = createSupervisorRunFixture({
      status: "needs_user",
      tasks: [failed],
    });
    const busy = Object.assign(new Error("repository already has a writer"), {
      code: "DIRECT_WORKSPACE_BUSY",
    });
    const harness = createHarness(base, {
      workspaces: {
        prepare: () => Promise.reject(busy),
        dispose: () => Promise.resolve(),
      } as unknown as WorkerWorkspacePort,
    });

    const retried = await harness.service.retryTask({
      runId: base.runId,
      userId: base.userId,
      taskId: failed.taskId,
    });

    expect(retried.status).toBe("queued");
    expect(retried.tasks[0]?.status).toBe("ready");
    expect(harness.dispatched).toEqual([]);
  });

  test("requires an explicit typed resolution before recording user criterion acceptance", async () => {
    const sourceGoalContract = sourceGoalContractFixture();
    sourceGoalContract.contract.acceptanceCriteria = [
      {
        criterionId: "criterion-user",
        statement: "The semantic outcome is acceptable",
        evidence: "user",
      },
    ];
    sourceGoalContract.contract.authority.finalIntegration = "auto";
    const task = createTask("task-user", {
      criterionIds: ["criterion-user"],
      status: "completed",
      outcome: "succeeded",
      acceptance: "machine_verified",
      verification: {
        verificationId: "verification-user",
        status: "passed",
        evidenceRefs: ["evidence-user"],
      },
      integration: {
        integrationId: "integration-user",
        status: "not_required",
      },
    });
    const base = createSupervisorRunFixture({
      sourceGoalContract,
      status: "needs_user",
      blockingDecisionId: "decision-user-criterion",
      tasks: [task],
      decisions: [
        {
          decisionId: "decision-user-criterion",
          kind: "goal_criteria_acceptance",
          status: "open",
          prompt: "Explicitly accept or waive criterion-user",
          criterionIds: ["criterion-user"],
          createdAt: "2026-07-11T00:00:30.000Z",
        },
      ],
    });
    const harness = createHarness(base);

    await expect(
      harness.service.answerDecision({
        runId: base.runId,
        userId: base.userId,
        decisionId: "decision-user-criterion",
        answer: "Looks okay, maybe",
        expectedRevision: base.revision,
      })
    ).rejects.toThrow("explicit accept or waive");

    const accepted = await harness.service.answerDecision({
      runId: base.runId,
      userId: base.userId,
      decisionId: "decision-user-criterion",
      answer: "Accepted after semantic review",
      criterionResolution: "accept",
      expectedRevision: base.revision,
    });

    expect(accepted.goalCriterionResolutions).toEqual([
      expect.objectContaining({
        criterionId: "criterion-user",
        resolution: "user_accepted",
        decisionId: "decision-user-criterion",
      }),
    ]);
  });

  test("answers a final delivery decision by revalidating and committing without a manager replan", async () => {
    const managerDispatches: string[] = [];
    const commitRevisions: number[] = [];
    const task = createTask("task-a", {
      status: "completed",
      verificationCommands: ["bun test"],
    });
    const base = createSupervisorRunFixture({
      status: "needs_user",
      tasks: [task],
      plan: {
        version: 1,
        hash: "a".repeat(64),
        summary: "Create the approved result",
        envelope: {
          goal: "Implement a safe multi-worker feature",
          fileScopes: ["packages/runtime/src/index.ts"],
          verificationCommands: ["bun test"],
          successCriteria: ["Tests pass"],
          permissionScopes: ["write"],
          destructiveActions: [],
          delivery: {
            createCommit: true,
            targetBranch: "main",
            targetHead: "abc123",
            allowDefaultBranch: true,
          },
        },
        approvedAt: "2026-07-11T00:00:00.000Z",
        approvedByUserId: "user-1",
      },
      decisions: [
        {
          decisionId: "decision-final-commit",
          kind: "baseline_drift",
          status: "open",
          prompt: "Approved branch or HEAD changed before final commit",
          createdAt: "2026-07-11T00:00:30.000Z",
        },
      ],
    });
    const harness = createHarness(base, {
      manager: {
        dispatch(input) {
          managerDispatches.push(input.turnKind);
          return Promise.resolve(base);
        },
        stop: () => Promise.resolve(base),
      },
      finalVerifier: {
        verify({ commands }) {
          return Promise.resolve(
            commands.map((command) => ({
              command,
              exitCode: 0,
              outputSummary: "passed",
              startedAt: "2026-07-11T00:00:40.000Z",
              finishedAt: "2026-07-11T00:00:50.000Z",
            }))
          );
        },
      },
      finalCommit: {
        commit(run) {
          commitRevisions.push(run.revision);
          return Promise.resolve({
            commitSha: "b".repeat(40),
            safetyRef: "refs/eragear/safety/run-1",
          });
        },
      },
    });

    const completed = await harness.service.answerDecision({
      runId: base.runId,
      userId: base.userId,
      decisionId: "decision-final-commit",
      answer: "Retry against the unchanged approved branch and HEAD",
      expectedRevision: base.revision,
    });

    expect(completed.status).toBe("completing");
    expect(completed.finalCommitSha).toBeUndefined();
    expect(completed.decisions[0]).toMatchObject({
      status: "answered",
      answeredByUserId: "user-1",
    });
    expect(managerDispatches).toEqual([]);
    expect(commitRevisions).toHaveLength(0);
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
    expect(approved.tasks[0]?.status).toBe("needs_user");
    expect(approved.tasks[0]?.integration).toMatchObject({
      status: "pending",
      workspaceId: "workspace-1",
    });
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
    const proposed = await harness.service.replan(base.runId, base.userId);
    expect(proposed.status).toBe("awaiting_approval");
    const replanned = await approveDraft(harness, proposed);
    expect(replanned.plannerReplanCount).toBe(1);
    expect(replanned.tasks[0]?.taskId).toBe("task-b");
    expect(replanned.tasks[0]?.status).toBe("ready");
    expect(harness.dispatched).toEqual([]);

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
