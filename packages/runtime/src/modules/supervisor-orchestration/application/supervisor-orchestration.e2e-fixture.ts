import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type WorkflowEffectRecord,
  WorkflowEffectUncertainError,
} from "#runtime/modules/workflow";
// biome-ignore lint/style/noRestrictedImports: This E2E composition root intentionally wires the production SQLite adapter.
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
// biome-ignore lint/style/noRestrictedImports: This E2E composition root resets isolated test storage between runs.
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
// biome-ignore lint/style/noRestrictedImports: This E2E composition root intentionally exercises the production journal adapter.
import { WorkflowJournalSqliteAdapter } from "../../workflow/infra/workflow-journal.repository.sqlite";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorVerificationEvidence,
} from "../domain/supervisor-run.schemas";
// biome-ignore lint/style/noRestrictedImports: This E2E composition root verifies the journal-backed compatibility repository.
import { JournaledSupervisorRunRepository } from "../infra/journaled-supervisor-run.repository";
// biome-ignore lint/style/noRestrictedImports: This E2E composition root uses production SQLite reads against an isolated database.
import { SupervisorRunSqliteRepository } from "../infra/supervisor-run.repository.sqlite";
import { buildAcpManagerPrompt } from "./acp-manager-prompt.builder";
import type { AcpManagerPlanTurn } from "./contracts/acp-manager-turn.contract";
import type { SupervisorPlannerProposal } from "./contracts/supervisor-planner.contract";
import {
  assertPreparedSupervisorPrompt,
  computeSupervisorPromptHash,
  type PreparedSupervisorPrompt,
  type SupervisorEffectPromptDispatchPort,
} from "./ports/supervisor-effect-prompt-dispatch.port";
import type { CreateSupervisorRunDraftInput } from "./ports/supervisor-orchestrator.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerWorkspacePort } from "./ports/worker-workspace.port";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorPlannerService } from "./supervisor-planner.service";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import {
  type SupervisorWorkflowEffectContext,
  type SupervisorWorkflowEffectFacade,
  SupervisorWorkflowRuntimeService,
} from "./supervisor-workflow-runtime.service";
import {
  buildWorkerPrompt,
  buildWorkerResumePrompt,
} from "./worker-prompt.builder";
import { WorkerResultService } from "./worker-result.service";
import { WorkerSessionManagerService } from "./worker-session-manager.service";

const E2E_NOW = "2026-07-11T00:02:00.000Z";
const E2E_VERIFICATION_COMMAND = "verify-all";

export interface SupervisorOrchestrationE2eHarnessOptions {
  crashAfterDispatchTaskId?: string;
  failFirstCancellationStop?: boolean;
}

export async function createSupervisorOrchestrationE2eHarness(
  options: SupervisorOrchestrationE2eHarnessOptions = {}
) {
  const previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
  await closeSqliteStorage();
  const tempStorageDir = await mkdtemp(
    path.join(os.tmpdir(), "eragear-supervisor-runtime-e2e-")
  );
  process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
  resetStoragePathCacheForTests();

  const journal = new WorkflowJournalSqliteAdapter();
  const reads = new SupervisorRunSqliteRepository();
  const runs = new JournaledSupervisorRunRepository(reads, journal);
  const createdChats: string[] = [];
  const createdSessions: string[] = [];
  const stoppedChats: string[] = [];
  const disposedWorkspaceIds: string[] = [];
  const prompts: Parameters<
    SupervisorEffectPromptDispatchPort["execute"]
  >[0][] = [];
  const reasonerPrompts: PreparedSupervisorPrompt[] = [];
  const activeRoots = new Set<string>();
  const disposedRoots: string[] = [];
  let workerId = 0;
  let crashInjected = false;
  let cancellationStopFailureInjected = false;
  let disposed = false;

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
    effectPromptDispatch: {
      execute(input) {
        assertPromptDispatchEnvelope(input);
        prompts.push(structuredClone(input));
        if (
          !crashInjected &&
          input.workflow.workItemId === options.crashAfterDispatchTaskId
        ) {
          crashInjected = true;
          throw new WorkflowEffectUncertainError({
            code: "E2E_DISPATCH_SENT_BEFORE_ACK",
            effectId: input.workflow.effectId,
            ...(input.workflow.workItemId
              ? { workItemId: input.workflow.workItemId }
              : {}),
          });
        }
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
    now: () => E2E_NOW,
    createId(prefix) {
      workerId += 1;
      return `${prefix}-${workerId}`;
    },
  });
  const workspaces: WorkerWorkspacePort = {
    prepare(input) {
      const workspaceId = `workspace-${input.taskId}-${input.attemptKey}`;
      if (input.executionMode === "write") {
        activeRoots.add(input.projectRoot);
      }
      return Promise.resolve({
        workspaceId,
        kind: "read_only",
        userProjectRoot: input.projectRoot,
        projectRoot: input.projectRoot,
        targetFingerprints: {},
      });
    },
    claim: () => Promise.resolve(),
    collect: () =>
      Promise.reject(new Error("read-only e2e does not collect patches")),
    apply: () =>
      Promise.reject(new Error("read-only e2e does not apply patches")),
    fingerprint: () => Promise.resolve({}),
    dispose(workspace) {
      activeRoots.delete(workspace.projectRoot);
      disposedRoots.push(workspace.projectRoot);
      disposedWorkspaceIds.push(workspace.workspaceId);
      return Promise.resolve();
    },
  };
  const proposal = createE2eProposal();
  const planner = new SupervisorPlannerService(
    { propose: () => Promise.resolve(structuredClone(proposal)) },
    {
      trustedVerificationCommandsByRole: {
        research: [E2E_VERIFICATION_COMMAND],
        implementation: [E2E_VERIFICATION_COMMAND],
        test: [E2E_VERIFICATION_COMMAND],
        review: [E2E_VERIFICATION_COMMAND],
        integration: [E2E_VERIFICATION_COMMAND],
      },
      defaultAgentIdByRole: {
        research: "agent-1",
        implementation: "agent-1",
        test: "agent-1",
        review: "agent-1",
        integration: "agent-1",
      },
    }
  );
  let orchestrator!: SupervisorOrchestratorService;
  const effects: SupervisorWorkflowEffectFacade = {
    requestPlan(context) {
      const expected = buildAcpManagerPrompt({
        run: context.run,
        turnKind: context.run.plan ? "replan" : "plan",
        trustedVerificationCommands: [E2E_VERIFICATION_COMMAND],
      });
      reasonerPrompts.push(
        structuredClone(assertCanonicalEffectPrompt(context, expected))
      );
      return Promise.resolve({ kind: "plan_requested" });
    },
    requestCapacity(context) {
      return Promise.resolve({
        kind: "capacity_observed",
        taskId: requireIntentString(context, "workItemId"),
        available: true,
        agentIdentityId:
          optionalIntentString(context, "assignedAgentIdentityId") ?? "agent-1",
      });
    },
    async startTurn(context) {
      const taskId = requireIntentString(context, "workItemId");
      const task = requireTask(context.run, taskId);
      const preparedPrompt = assertCanonicalEffectPrompt(
        context,
        buildWorkerPrompt({
          run: context.run,
          task,
          dependencySummaries: collectDependencySummaries(context.run, task),
        })
      );
      const updated = await orchestrator.executeWorkflowStartTurnEffect({
        runId: context.run.runId,
        userId: context.userId,
        taskId,
        preparedPrompt,
      });
      const attempt = requireTask(updated, taskId).attempts.find(
        (candidate) => candidate.idempotencyKey === context.effect.effectId
      );
      if (!attempt) {
        throw new Error(`No persisted attempt for ${context.effect.effectId}`);
      }
      return { kind: "turn_started", taskId, attemptId: attempt.attemptId };
    },
    resumeSession(context) {
      const taskId = requireIntentString(context, "workItemId");
      const attemptId = requireIntentString(context, "attemptId");
      const task = requireTask(context.run, taskId);
      const attempt = requireAttempt(task, attemptId);
      assertCanonicalEffectPrompt(
        context,
        attempt.turnId
          ? buildWorkerResumePrompt(task)
          : buildWorkerPrompt({
              run: context.run,
              task,
              dependencySummaries: collectDependencySummaries(
                context.run,
                task
              ),
            })
      );
      return Promise.resolve({ kind: "session_resumed", taskId, attemptId });
    },
    resumeManagerSession(context) {
      const prepared = assertRequiredPreparedPrompt(context);
      if (prepared.promptHash !== computeSupervisorPromptHash(prepared.text)) {
        throw new Error("Manager resume prompt hash does not match text");
      }
      return Promise.resolve({
        kind: "manager_session_resumed",
        waitId: requireIntentString(context, "waitId"),
      });
    },
    inspectUncertainTurn(context) {
      const taskId = requireIntentString(context, "workItemId");
      const attemptId = requireIntentString(context, "attemptId");
      if (taskId === options.crashAfterDispatchTaskId) {
        return Promise.resolve({
          kind: "uncertain_turn_inspected",
          taskId,
          attemptId,
          disposition: "needs_user",
          decisionId: `${context.effect.effectId}-review`,
        });
      }
      return Promise.resolve({
        kind: "uncertain_turn_inspected",
        taskId,
        attemptId,
        disposition: "running",
      });
    },
    runVerification(context) {
      const scope = requireIntentString(context, "scope");
      const taskId = optionalIntentString(context, "workItemId");
      const commands =
        scope === "run"
          ? [E2E_VERIFICATION_COMMAND]
          : requireTask(context.run, taskId as string).verificationCommands;
      const evidence = createVerificationEvidence(commands);
      return Promise.resolve({
        kind: "verification_completed",
        scope: scope === "run" ? "run" : "work_item",
        ...(taskId ? { taskId } : {}),
        passed: true,
        evidenceRefs: evidence.map(
          (_item, index) =>
            `e2e-evidence-${taskId ?? "run"}-${context.effect.effectId}-${index}`
        ),
        evidence,
      });
    },
    requestDecision(context) {
      return Promise.resolve({
        kind: "decision_requested",
        decisionId: requireIntentString(context, "decisionId"),
        ...(optionalIntentString(context, "workItemId")
          ? { taskId: optionalIntentString(context, "workItemId") }
          : {}),
      });
    },
    async integrateWorkspace(context) {
      const taskId = requireIntentString(context, "workItemId");
      const attemptId = requireIntentString(context, "attemptId");
      const attempt = requireAttempt(
        requireTask(context.run, taskId),
        attemptId
      );
      if (attempt.workspace) {
        await workspaces.dispose(attempt.workspace);
      }
      return {
        kind: "integration_completed",
        taskId,
        passed: true,
        files: attempt.result?.files,
      };
    },
    stopAgentSession(context) {
      const sessionId = requireIntentString(context, "sessionId");
      stoppedChats.push(sessionId);
      if (
        options.failFirstCancellationStop &&
        !cancellationStopFailureInjected
      ) {
        cancellationStopFailureInjected = true;
        throw new Error("simulated cancellation cleanup failure");
      }
      return Promise.resolve({ kind: "agent_session_stopped", sessionId });
    },
    async disposeWorkspace(context) {
      const workspaceId = requireIntentString(context, "workspaceId");
      const workspace = context.run.tasks
        .flatMap((task) => task.attempts)
        .find(
          (attempt) => attempt.workspace?.workspaceId === workspaceId
        )?.workspace;
      if (workspace) {
        await workspaces.dispose(workspace);
      }
      return { kind: "workspace_disposed", workspaceId };
    },
    createFinalCommit() {
      return Promise.resolve({
        kind: "final_commit_created",
        commitSha: "e2e-final-commit",
        safetyRef: "refs/eragear/e2e-final-safety",
      });
    },
  };
  const workflowRuntime = new SupervisorWorkflowRuntimeService({
    runs,
    journal,
    unitOfWork: journal,
    effects,
    trustedVerificationCommands: [E2E_VERIFICATION_COMMAND],
    now: () => E2E_NOW,
    maxReconcilePasses: 16,
  });
  let orchestratorId = 0;
  orchestrator = new SupervisorOrchestratorService({
    runs,
    planner,
    scheduler: new SupervisorSchedulerService(),
    workers: workerSessions,
    agents: {
      listEligible: async () => [
        {
          agentId: "agent-1",
          displayName: "Fake ACP agent",
          active: true,
          managerEligible: true,
          roles: [
            "research",
            "implementation",
            "test",
            "review",
            "integration",
          ],
        },
      ],
    },
    baseSnapshot: {
      capture: async () => ({
        head: "e2e-head",
        branch: "main",
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: E2E_NOW,
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
      verify: async ({ commands }) => createVerificationEvidence(commands),
    },
    now: () => E2E_NOW,
    createId(prefix) {
      orchestratorId += 1;
      return `${prefix}-${orchestratorId}`;
    },
  });
  orchestrator.setWorkflowPump((runId, userId) =>
    workflowRuntime.pumpRun({ runId, userId })
  );

  async function startDraft(input: CreateSupervisorRunDraftInput) {
    const planning = await orchestrator.start(input);
    if (planning.workflowPlan?.status !== "requested") {
      throw new Error("Workflow runtime did not durably request a plan");
    }
    return await orchestrator.recordManagerTurn({
      runId: planning.runId,
      userId: planning.userId,
      turn: createE2eManagerTurn(planning, proposal),
    });
  }

  async function recordSuccess(runId: string, taskId: string) {
    const run = await requireRun(runs, runId);
    const task = requireTask(run, taskId);
    const attempt = task.attempts.at(-1);
    if (!attempt) {
      throw new Error(`No active attempt for ${taskId}`);
    }
    await orchestrator.recordWorkerResult({
      runId,
      userId: run.userId,
      taskId,
      attemptId: attempt.attemptId,
      result: {
        semanticStatus: "succeeded",
        reason: "fake worker completed",
        outcomeSummary: `${taskId} complete`,
        files: { touched: [], created: [], deleted: [], renamed: [] },
        verification: createVerificationEvidence([E2E_VERIFICATION_COMMAND]),
        toolFailureSummary: [],
        unresolvedPermissions: [],
        agentId: attempt.agentId,
        chatId: attempt.chatId,
        ...(attempt.agentSessionId
          ? { agentSessionId: attempt.agentSessionId }
          : {}),
        startedAt: attempt.startedAt,
        finishedAt: E2E_NOW,
      },
    });
    await workflowRuntime.tick();
    return await requireRun(runs, runId);
  }

  async function approveDraft(draft: SupervisorRunState) {
    if (!draft.plan) {
      throw new Error("Expected an e2e plan proposal");
    }
    await orchestrator.approvePlan({
      runId: draft.runId,
      userId: draft.userId,
      planVersion: draft.plan.version,
      planHash: draft.plan.hash,
      expectedRevision: draft.revision,
    });
    await workflowRuntime.tick();
    return await requireRun(runs, draft.runId);
  }

  async function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    await closeSqliteStorage();
    resetStoragePathCacheForTests();
    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }
    await removeTempDirWithRetry(tempStorageDir);
  }

  return {
    orchestrator,
    workflowRuntime,
    journal,
    runs,
    createdChats,
    createdSessions,
    stoppedChats,
    prompts,
    reasonerPrompts,
    activeRoots,
    disposedRoots,
    disposedWorkspaceIds,
    approveDraft,
    dispose,
    recordSuccess,
    startDraft,
  };
}

function createE2eProposal(): SupervisorPlannerProposal {
  const task = (
    taskId: string,
    dependencies: string[],
    role: "research" | "test"
  ) => ({
    taskId,
    title: taskId,
    goal: `Complete ${taskId}`,
    role,
    executionMode: "read_only" as const,
    dependencies,
    criterionIds: [],
    changeKinds: [],
    candidateAgentId: "agent-1",
    scopeIntent: [],
    verificationRequirements: [E2E_VERIFICATION_COMMAND],
  });
  return {
    schemaVersion: 1,
    summary: "e2e DAG",
    tasks: [
      task("parallel-a", [], "research"),
      task("parallel-b", [], "research"),
      task("dependent-c", ["parallel-a", "parallel-b"], "test"),
    ],
  };
}

function createE2eManagerTurn(
  run: SupervisorRunState,
  proposal: SupervisorPlannerProposal
): AcpManagerPlanTurn {
  return {
    schemaVersion: 1,
    kind: "plan",
    summary: proposal.summary,
    risks: [],
    tasks: structuredClone(proposal.tasks),
    envelope: {
      goal: run.originalIntent,
      fileScopes: [],
      verificationCommands: [E2E_VERIFICATION_COMMAND],
      successCriteria: ["All deterministic task and aggregate gates pass"],
      permissionScopes: ["project-root-sandbox"],
      destructiveActions: [],
      delivery: {
        createCommit: true,
        targetBranch: run.baseSnapshot.branch ?? "main",
        targetHead: run.baseSnapshot.head ?? "e2e-head",
        allowDefaultBranch: true,
      },
    },
  };
}

function createVerificationEvidence(
  commands: string[]
): SupervisorVerificationEvidence[] {
  return commands.map((command) => ({
    command,
    exitCode: 0,
    outputSummary: "aggregate verification passed",
    startedAt: E2E_NOW,
    finishedAt: E2E_NOW,
  }));
}

function assertPromptDispatchEnvelope(
  input: Parameters<SupervisorEffectPromptDispatchPort["execute"]>[0]
): void {
  if (
    input.source !== "orchestrator" ||
    input.workflow.promptHash !== computeSupervisorPromptHash(input.text)
  ) {
    throw new Error("E2E prompt dispatch is missing its durable hash envelope");
  }
}

function assertCanonicalEffectPrompt(
  context: SupervisorWorkflowEffectContext,
  expectedText: string
): PreparedSupervisorPrompt {
  const prepared = assertRequiredPreparedPrompt(context);
  assertPreparedSupervisorPrompt(expectedText, prepared);
  if (
    prepared.effectId !== context.effect.effectId ||
    prepared.authorityId !== context.effect.authorityId ||
    prepared.promptHash !== context.effect.promptHash
  ) {
    throw new Error("Prepared prompt is not bound to its durable effect");
  }
  return prepared;
}

function assertRequiredPreparedPrompt(
  context: SupervisorWorkflowEffectContext
): PreparedSupervisorPrompt {
  if (!context.preparedPrompt) {
    throw new Error(`Workflow effect ${context.effect.effectId} has no prompt`);
  }
  return context.preparedPrompt;
}

function requireIntentString(
  context: SupervisorWorkflowEffectContext,
  key: string
): string {
  const value = optionalIntentString(context, key);
  if (!value) {
    throw new Error(`Workflow effect intent is missing ${key}`);
  }
  return value;
}

function optionalIntentString(
  context: SupervisorWorkflowEffectContext,
  key: string
): string | undefined {
  const value = context.intent[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function collectDependencySummaries(
  run: SupervisorRunState,
  task: SupervisorTaskRecord
) {
  return task.dependencies.map((dependencyId) => {
    const dependency = requireTask(run, dependencyId);
    const summary = [...dependency.attempts]
      .reverse()
      .find((attempt) => attempt.result)?.result?.outcomeSummary;
    if (!summary) {
      throw new Error(`Dependency ${dependencyId} has no result summary`);
    }
    return { taskId: dependencyId, summary };
  });
}

async function requireRun(
  runs: SupervisorRunRepositoryPort,
  runId: string
): Promise<SupervisorRunState> {
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

function requireAttempt(task: SupervisorTaskRecord, attemptId: string) {
  const attempt = task.attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }
  return attempt;
}

export function findWorkflowEffectForPrompt(
  effects: WorkflowEffectRecord[],
  prompt: Parameters<SupervisorEffectPromptDispatchPort["execute"]>[0]
) {
  return effects.find((effect) => effect.effectId === prompt.workflow.effectId);
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      if (attempt === 9) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
