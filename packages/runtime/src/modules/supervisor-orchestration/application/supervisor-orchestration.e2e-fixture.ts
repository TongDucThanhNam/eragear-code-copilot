import type {
  SupervisorRunState,
  SupervisorTaskRecord,
} from "../domain/supervisor-run.schemas";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerWorkspacePort } from "./ports/worker-workspace.port";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import { WorkerResultService } from "./worker-result.service";
import { WorkerSessionManagerService } from "./worker-session-manager.service";

class E2eRunRepository implements SupervisorRunRepositoryPort {
  private readonly runs = new Map<string, SupervisorRunState>();
  create(run: SupervisorRunState) {
    this.runs.set(run.runId, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }
  get(runId: string, userId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(
      run?.userId === userId ? structuredClone(run) : null
    );
  }
  list(input: { userId: string }) {
    return Promise.resolve(
      [...this.runs.values()]
        .filter((run) => run.userId === input.userId)
        .map((run) => structuredClone(run))
    );
  }
  listNonTerminal() {
    return Promise.resolve(
      [...this.runs.values()].map((run) => structuredClone(run))
    );
  }
  save(run: SupervisorRunState, expectedRevision: number) {
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

export function createSupervisorOrchestrationE2eHarness() {
  const runs = new E2eRunRepository();
  const createdChats: string[] = [];
  const createdSessions: string[] = [];
  const stoppedChats: string[] = [];
  const prompts: Array<{ chatId: string; text: string }> = [];
  const activeRoots = new Set<string>();
  const disposedRoots: string[] = [];
  let workerId = 0;
  const workerSessions = new WorkerSessionManagerService({
    runs,
    createSession: {
      execute(input) {
        const sessionId = `agent-session-${createdSessions.length + 1}`;
        createdChats.push(input.chatId ?? "missing");
        createdSessions.push(sessionId);
        return Promise.resolve({ id: input.chatId ?? "missing", sessionId });
      },
    },
    sendMessage: {
      execute(input) {
        prompts.push({ chatId: input.chatId, text: input.text });
        return Promise.resolve({ turnId: `turn-${prompts.length}` });
      },
    },
    stopSession: {
      execute(_userId, chatId) {
        stoppedChats.push(chatId);
        return Promise.resolve({});
      },
    },
    resumeSession: { execute: () => Promise.resolve({}) },
    now: () => "2026-07-11T00:01:00.000Z",
    createId(prefix) {
      workerId += 1;
      return `${prefix}-${workerId}`;
    },
  });
  const workspaces: WorkerWorkspacePort = {
    prepare(input) {
      const root = `${input.projectRoot}/.fake-workers/${input.taskId}-${input.attemptKey}`;
      activeRoots.add(root);
      return Promise.resolve({
        workspaceId: `workspace-${input.taskId}-${input.attemptKey}`,
        kind: "read_only",
        userProjectRoot: input.projectRoot,
        projectRoot: root,
        targetFingerprints: {},
      });
    },
    collect: () =>
      Promise.reject(new Error("read-only e2e does not collect patches")),
    apply: () =>
      Promise.reject(new Error("read-only e2e does not apply patches")),
    fingerprint: () => Promise.resolve({}),
    dispose(workspace) {
      activeRoots.delete(workspace.projectRoot);
      disposedRoots.push(workspace.projectRoot);
      return Promise.resolve();
    },
  };
  let orchestratorId = 0;
  const orchestrator = new SupervisorOrchestratorService({
    runs,
    planner: {
      plan: async () => ({
        proposal: { schemaVersion: 1, summary: "e2e DAG", tasks: [] },
        tasks: createE2eTasks(),
      }),
      replan: async () => ({
        proposal: { schemaVersion: 1, summary: "e2e DAG", tasks: [] },
        tasks: createE2eTasks(),
      }),
    },
    scheduler: new SupervisorSchedulerService(),
    workers: workerSessions,
    agents: {
      listEligible: async () => [
        {
          agentId: "agent-1",
          displayName: "Fake ACP agent",
          active: true,
          roles: ["research", "test"],
        },
      ],
    },
    baseSnapshot: {
      capture: async () => ({
        head: "e2e-head",
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      }),
    },
    workspaces,
    integration: {
      integrate: async (input) => {
        await workspaces.dispose(input.workspace);
        return { decision: "allow" as const, reasons: [] };
      },
    },
    results: new WorkerResultService(),
    finalVerifier: {
      verify: async ({ commands }) =>
        commands.map((command) => ({
          command,
          exitCode: 0,
          outputSummary: "aggregate verification passed",
          startedAt: "2026-07-11T00:02:00.000Z",
          finishedAt: "2026-07-11T00:02:01.000Z",
        })),
    },
    now: () => "2026-07-11T00:02:00.000Z",
    createId(prefix) {
      orchestratorId += 1;
      return `${prefix}-${orchestratorId}`;
    },
  });

  async function recordSuccess(runId: string, taskId: string) {
    const run = await requireRun(runs, runId);
    const task = requireTask(run, taskId);
    const attempt = task.attempts.at(-1);
    if (!attempt) {
      throw new Error(`No active attempt for ${taskId}`);
    }
    return await orchestrator.recordWorkerResult({
      runId,
      userId: run.userId,
      taskId,
      attemptId: attempt.attemptId,
      result: {
        semanticStatus: "succeeded",
        reason: "fake worker completed",
        outcomeSummary: `${taskId} complete`,
        files: { touched: [], created: [], deleted: [], renamed: [] },
        verification: [
          {
            command: "verify-all",
            exitCode: 0,
            outputSummary: "passed",
            startedAt: "2026-07-11T00:01:00.000Z",
            finishedAt: "2026-07-11T00:01:01.000Z",
          },
        ],
        toolFailureSummary: [],
        unresolvedPermissions: [],
        agentId: attempt.agentId,
        chatId: attempt.chatId,
        ...(attempt.agentSessionId
          ? { agentSessionId: attempt.agentSessionId }
          : {}),
        startedAt: attempt.startedAt,
        finishedAt: "2026-07-11T00:01:01.000Z",
      },
    });
  }
  async function approveDraft(draft: SupervisorRunState) {
    if (!draft.plan) {
      throw new Error("Expected an e2e plan proposal");
    }
    return await orchestrator.approvePlan({
      runId: draft.runId,
      userId: draft.userId,
      planVersion: draft.plan.version,
      planHash: draft.plan.hash,
      expectedRevision: draft.revision,
    });
  }
  return {
    orchestrator,
    runs,
    createdChats,
    createdSessions,
    stoppedChats,
    prompts,
    activeRoots,
    disposedRoots,
    approveDraft,
    recordSuccess,
  };
}

function createE2eTasks(): SupervisorTaskRecord[] {
  const task = (
    taskId: string,
    dependencies: string[],
    role: "research" | "test"
  ): SupervisorTaskRecord => ({
    taskId,
    title: taskId,
    goal: `Complete ${taskId}`,
    role,
    executionMode: "read_only",
    dependencies,
    filesAllowed: [],
    verificationCommands: ["verify-all"],
    preferredAgentId: "agent-1",
    status: dependencies.length === 0 ? "ready" : "blocked",
    attempts: [],
  });
  return [
    task("parallel-a", [], "research"),
    task("parallel-b", [], "research"),
    task("dependent-c", ["parallel-a", "parallel-b"], "test"),
  ];
}

async function requireRun(runs: E2eRunRepository, runId: string) {
  const run = await runs.get(runId, "user-1");
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  return run;
}

function requireTask(run: SupervisorRunState, taskId: string) {
  const task = run.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}
