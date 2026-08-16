import { describe, expect, test } from "bun:test";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerSessionManagerPort } from "./ports/worker-session-manager.port";
import type { WorkerWorkspacePort } from "./ports/worker-workspace.port";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import { WorkerResultService } from "./worker-result.service";

const NOW = "2026-07-11T00:01:00.000Z";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private run: SupervisorRunState;

  constructor(run: SupervisorRunState) {
    this.run = structuredClone(run);
  }

  create(run: SupervisorRunState): Promise<SupervisorRunState> {
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }

  get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    return Promise.resolve(
      this.run.runId === runId && this.run.userId === userId
        ? structuredClone(this.run)
        : null
    );
  }

  list(): Promise<SupervisorRunState[]> {
    return Promise.resolve([structuredClone(this.run)]);
  }

  listNonTerminal(): Promise<SupervisorRunState[]> {
    return Promise.resolve([structuredClone(this.run)]);
  }

  save(
    run: SupervisorRunState,
    expectedRevision: number
  ): Promise<SupervisorRunState> {
    if (this.run.revision !== expectedRevision) {
      return Promise.reject(
        new SupervisorRunRevisionConflictError(
          run.runId,
          expectedRevision,
          this.run.revision
        )
      );
    }
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
}

function createReadOnlyTask(
  taskId: string,
  status: SupervisorTaskRecord["status"],
  dependencies: string[] = []
): SupervisorTaskRecord {
  const source = createSupervisorRunFixture().tasks[0];
  if (!source) {
    throw new Error("Task fixture missing");
  }
  return {
    ...source,
    taskId,
    title: taskId,
    goal: taskId,
    executionMode: "read_only",
    dependencies,
    verificationCommands: ["bun test"],
    preferredAgentId: "agent-1",
    status,
    attempts:
      status === "running"
        ? [
            {
              attemptId: `attempt-${taskId}`,
              chatId: `chat-${taskId}`,
              agentId: "agent-1",
              status: "running",
              idempotencyKey: `run:${taskId}:1`,
              startedAt: "2026-07-11T00:00:00.000Z",
              workspace: {
                workspaceId: `workspace-${taskId}`,
                kind: "read_only",
                userProjectRoot: "C:/repo",
                projectRoot: "C:/repo",
                targetFingerprints: {},
              },
            },
          ]
        : [],
  };
}

function createResult(taskId: string): SupervisorWorkerResult {
  return {
    semanticStatus: "succeeded",
    reason: "complete",
    outcomeSummary: `${taskId} complete`,
    files: { touched: [], created: [], deleted: [], renamed: [] },
    verification: [
      {
        command: "bun test",
        exitCode: 0,
        outputSummary: "pass",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: NOW,
      },
    ],
    toolFailureSummary: [],
    unresolvedPermissions: [],
    agentId: "agent-1",
    chatId: `chat-${taskId}`,
    startedAt: "2026-07-11T00:00:00.000Z",
    finishedAt: NOW,
  };
}

function createHarness(
  run: SupervisorRunState,
  validatedTasks: SupervisorTaskRecord[] = [
    createReadOnlyTask("task-a", "ready"),
  ]
) {
  const runs = new MemoryRuns(run);
  const dispatched: string[] = [];
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
          idempotencyKey: `run:${input.taskId}:1`,
          startedAt: NOW,
        },
      });
    },
    release() {
      return Promise.resolve();
    },
  } as unknown as WorkerSessionManagerPort;
  const workspaces = {
    prepare(input: Parameters<WorkerWorkspacePort["prepare"]>[0]) {
      return Promise.resolve({
        workspaceId: `workspace-${input.taskId}`,
        kind: "read_only" as const,
        userProjectRoot: input.projectRoot,
        projectRoot: input.projectRoot,
        targetFingerprints: {},
      });
    },
    dispose() {
      return Promise.resolve();
    },
  } as unknown as WorkerWorkspacePort;
  const service = new SupervisorOrchestratorService({
    runs,
    planner: {
      plan: () => Promise.reject(),
      replan: () => Promise.reject(),
      validateProposal(_context, proposal) {
        return {
          proposal: proposal as never,
          tasks: structuredClone(validatedTasks),
        };
      },
    },
    scheduler: new SupervisorSchedulerService(),
    workers,
    agents: { listEligible: () => Promise.resolve([]) },
    baseSnapshot: { capture: () => Promise.resolve(run.baseSnapshot) },
    workspaces,
    integration: {
      integrate: () =>
        Promise.resolve({ decision: "allow" as const, reasons: [] }),
    },
    results: new WorkerResultService(),
    finalVerifier: {
      verify({ commands }) {
        return Promise.resolve(
          commands.map((command) => ({
            command,
            exitCode: 0,
            outputSummary: "aggregate pass",
            startedAt: NOW,
            finishedAt: NOW,
          }))
        );
      },
    },
    now: () => NOW,
    createId: (prefix) => `${prefix}-1`,
  });
  return { service, runs, dispatched };
}

describe("SupervisorOrchestratorService worker events", () => {
  test("normalizes trailing directory separators across tasks and the plan envelope", async () => {
    const run = createSupervisorRunFixture({ status: "planning", tasks: [] });
    const task = createReadOnlyTask("task-a", "ready");
    task.filesAllowed = ["demos/supervisos-biosphere-terminal"];
    const harness = createHarness(run, [task]);

    const updated = await harness.service.recordManagerTurn({
      runId: run.runId,
      userId: run.userId,
      turn: {
        schemaVersion: 1,
        kind: "plan",
        summary: "Build one isolated demo",
        risks: [],
        tasks: [
          {
            taskId: "task-a",
            title: "Build demo",
            goal: "Build the scoped demo",
            role: "implementation",
            executionMode: "write",
            dependencies: [],
            scopeIntent: ["demos/supervisos-biosphere-terminal/"],
            verificationRequirements: ["Run the scoped checks"],
          },
        ],
        envelope: {
          goal: run.originalIntent,
          fileScopes: ["demos/supervisos-biosphere-terminal/"],
          verificationCommands: ["bun test"],
          successCriteria: ["The scoped demo passes"],
          permissionScopes: ["write scoped demo files"],
          destructiveActions: [],
          delivery: {
            createCommit: true,
            targetBranch: run.baseSnapshot.branch ?? "master",
            targetHead: run.baseSnapshot.head ?? "abc123",
            allowDefaultBranch: false,
          },
        },
      },
    });

    expect(updated.status).toBe("awaiting_approval");
    expect(updated.plan?.envelope.fileScopes).toEqual([
      "demos/supervisos-biosphere-terminal",
    ]);
  });

  test("fails closed instead of leaving planning stuck when a manager plan changes the goal", async () => {
    const run = createSupervisorRunFixture({
      status: "planning",
      tasks: [],
    });
    const harness = createHarness(run);
    const updated = await harness.service.recordManagerTurn({
      runId: run.runId,
      userId: run.userId,
      turn: {
        schemaVersion: 1,
        kind: "plan",
        summary: "A rewritten goal",
        risks: [],
        tasks: [
          {
            taskId: "task-a",
            title: "Research",
            goal: "Read the target file",
            role: "research",
            executionMode: "read_only",
            dependencies: [],
            scopeIntent: ["packages/runtime/src/index.ts"],
            verificationRequirements: ["bun test"],
          },
        ],
        envelope: {
          goal: "A rewritten goal",
          fileScopes: ["packages/runtime/src/index.ts"],
          verificationCommands: ["bun test"],
          successCriteria: ["Report the result"],
          permissionScopes: ["read"],
          destructiveActions: [],
          delivery: {
            createCommit: true,
            targetBranch: run.baseSnapshot.branch ?? "master",
            targetHead: run.baseSnapshot.head ?? "abc123",
            allowDefaultBranch: false,
          },
        },
      },
    });

    expect(updated.status).toBe("needs_user");
    expect(updated.decisions).toContainEqual(
      expect.objectContaining({
        kind: "classifier_uncertain",
        status: "open",
        prompt: expect.stringContaining(
          "Manager plan changed the authoritative goal"
        ),
      })
    );
    expect(updated.audit).toContainEqual(
      expect.objectContaining({ kind: "plan_rejected" })
    );
  });

  test("records one result, completes the task, and unblocks one dependent dispatch", async () => {
    const first = createReadOnlyTask("task-a", "running");
    const second = createReadOnlyTask("task-b", "blocked", ["task-a"]);
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [first, second],
    });
    const harness = createHarness(run);
    const input = {
      runId: run.runId,
      userId: run.userId,
      taskId: first.taskId,
      attemptId: `attempt-${first.taskId}`,
      result: createResult(first.taskId),
    };
    const updated = await harness.service.recordWorkerResult(input);
    expect(updated.tasks[0]?.status).toBe("completed");
    expect(updated.tasks[1]?.status).toBe("queued");
    expect(harness.dispatched).toEqual(["task-b"]);

    await harness.service.recordWorkerResult(input);
    expect(harness.dispatched).toEqual(["task-b"]);
  });

  test("completes only after aggregate verification evidence passes", async () => {
    const task = createReadOnlyTask("task-a", "running");
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [task],
    });
    const harness = createHarness(run);
    const completed = await harness.service.recordWorkerResult({
      runId: run.runId,
      userId: run.userId,
      taskId: task.taskId,
      attemptId: `attempt-${task.taskId}`,
      result: createResult(task.taskId),
    });
    expect(completed.status).toBe("completed");
    expect(completed.finalVerification).toHaveLength(1);
    expect(completed.finalVerification[0]?.exitCode).toBe(0);
  });

  test("accepts a normal ACP handoff while Supervisos owns result evidence", async () => {
    const task = createReadOnlyTask("task-a", "running");
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [task],
    });
    const harness = createHarness(run);
    const handoff = [
      "Implemented the requested interaction.",
      "Checked keyboard behavior and ran the assigned tests.",
      "No remaining blocker.",
    ].join("\n");

    const completed = await harness.service.recordWorkerTerminal({
      runId: run.runId,
      userId: run.userId,
      taskId: task.taskId,
      attemptId: `attempt-${task.taskId}`,
      action: "done",
      reason: "ACP worker completed with a persisted assistant handoff.",
      resultText: handoff,
    });

    expect(completed.status).toBe("completed");
    expect(completed.tasks[0]?.attempts[0]?.result?.outcomeSummary).toBe(
      handoff
    );
    expect(completed.tasks[0]?.attempts[0]?.result?.verification).toEqual([
      expect.objectContaining({ command: "bun test", exitCode: 0 }),
    ]);
  });
});
