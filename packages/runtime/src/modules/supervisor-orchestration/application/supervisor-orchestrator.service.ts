import { createId } from "#runtime/shared/utils/id.util";
import {
  createDefaultSupervisorRunLimits,
  type SupervisorRunState,
  SupervisorRunStateSchema,
  type SupervisorTaskRecord,
  SupervisorWorkerResultSchema,
} from "../domain/supervisor-run.schemas";
import {
  recomputeSupervisorTaskReadiness,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import type { SupervisorPlannerAgent } from "./contracts/supervisor-planner.contract";
import type {
  StartSupervisorRunInput,
  SupervisorAgentCatalogPort,
  SupervisorBaseSnapshotPort,
  SupervisorDispatchAdmissionPort,
  SupervisorFinalVerifierPort,
} from "./ports/supervisor-orchestrator.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import type { WorkerSessionManagerPort } from "./ports/worker-session-manager.port";
import type {
  PreparedWorkerWorkspace,
  WorkerWorkspacePort,
} from "./ports/worker-workspace.port";
import type { SupervisorPlannerService } from "./supervisor-planner.service";
import type { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import type { WorkerIntegrationService } from "./worker-integration.service";
import { extractWorkerResult } from "./worker-result.extractor";
import type { WorkerResultService } from "./worker-result.service";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface SupervisorOrchestratorDeps {
  runs: SupervisorRunRepositoryPort;
  planner: Pick<SupervisorPlannerService, "plan" | "replan">;
  scheduler: SupervisorSchedulerService;
  workers: WorkerSessionManagerPort;
  agents: SupervisorAgentCatalogPort;
  baseSnapshot: SupervisorBaseSnapshotPort;
  workspaces: WorkerWorkspacePort;
  integration: Pick<WorkerIntegrationService, "integrate">;
  results: WorkerResultService;
  finalVerifier: SupervisorFinalVerifierPort;
  configuredLimits?: Partial<
    ReturnType<typeof createDefaultSupervisorRunLimits>
  >;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export class SupervisorOrchestratorService {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly planner: Pick<SupervisorPlannerService, "plan" | "replan">;
  private readonly scheduler: SupervisorSchedulerService;
  private readonly workers: WorkerSessionManagerPort;
  private readonly agents: SupervisorAgentCatalogPort;
  private readonly baseSnapshot: SupervisorBaseSnapshotPort;
  private readonly workspaces: WorkerWorkspacePort;
  private readonly integration: Pick<WorkerIntegrationService, "integrate">;
  private readonly results: WorkerResultService;
  private readonly finalVerifier: SupervisorFinalVerifierPort;
  private readonly configuredLimits: Partial<
    ReturnType<typeof createDefaultSupervisorRunLimits>
  >;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private dispatchAdmission?: SupervisorDispatchAdmissionPort;

  constructor(deps: SupervisorOrchestratorDeps) {
    this.runs = deps.runs;
    this.planner = deps.planner;
    this.scheduler = deps.scheduler;
    this.workers = deps.workers;
    this.agents = deps.agents;
    this.baseSnapshot = deps.baseSnapshot;
    this.workspaces = deps.workspaces;
    this.integration = deps.integration;
    this.results = deps.results;
    this.finalVerifier = deps.finalVerifier;
    this.configuredLimits = deps.configuredLimits ?? {};
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
  }

  setDispatchAdmission(port: SupervisorDispatchAdmissionPort): void {
    this.dispatchAdmission = port;
  }

  async start(input: StartSupervisorRunInput): Promise<SupervisorRunState> {
    const now = this.now();
    const configured = {
      ...createDefaultSupervisorRunLimits(),
      ...this.configuredLimits,
    };
    const requested = {
      ...configured,
      ...input.limits,
    };
    const limits = {
      maxConcurrency: Math.min(
        requested.maxConcurrency,
        configured.maxConcurrency
      ),
      maxTasks: Math.min(requested.maxTasks, configured.maxTasks),
      maxAttemptsPerTask: Math.min(
        requested.maxAttemptsPerTask,
        configured.maxAttemptsPerTask
      ),
      maxRunDurationMs: Math.min(
        requested.maxRunDurationMs,
        configured.maxRunDurationMs
      ),
      maxPlannerReplans: Math.min(
        requested.maxPlannerReplans,
        configured.maxPlannerReplans
      ),
    };
    const run = SupervisorRunStateSchema.parse({
      schemaVersion: 1,
      runId: this.idFactory("supervisor-run"),
      revision: 0,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      projectRoot: input.projectRoot,
      ...(input.originatingChatId
        ? { originatingChatId: input.originatingChatId }
        : {}),
      ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.workerModelId ? { workerModelId: input.workerModelId } : {}),
      ...(input.eligibleAgentIds
        ? { eligibleAgentIds: [...new Set(input.eligibleAgentIds)] }
        : {}),
      originalIntent: input.originalIntent,
      constraints: input.constraints ?? [],
      status: "planning",
      baseSnapshot: await this.baseSnapshot.capture({
        projectRoot: input.projectRoot,
      }),
      limits,
      tasks: [],
      gates: [],
      audit: [
        {
          auditId: this.idFactory("audit"),
          kind: "run_created",
          actor: "user",
          summary: "Supervisor run created and planning started",
          createdAt: now,
        },
      ],
      processedEventIds: [],
      plannerReplanCount: 0,
      finalVerification: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.runs.create(run);

    let planned: SupervisorRunState;
    try {
      const agents = filterEligibleAgents(
        await this.agents.listEligible({
          userId: input.userId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        }),
        input.eligibleAgentIds
      );
      if (agents.length === 0) {
        throw new Error("No configured agent satisfies the run restriction.");
      }
      const plan = await this.planner.plan({
        runId: run.runId,
        originalIntent: run.originalIntent,
        constraints: run.constraints,
        projectRoot: run.projectRoot,
        limits: run.limits,
        agents,
        ...(input.projectIndexSummary
          ? { projectIndexSummary: input.projectIndexSummary }
          : {}),
        ...(input.scopeResolutionSummary
          ? { scopeResolutionSummary: input.scopeResolutionSummary }
          : {}),
        completedTaskSummaries: [],
      });
      planned = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate: (draft) => {
          draft.tasks = plan.tasks;
          draft.status = "queued";
          draft.audit.push({
            auditId: this.idFactory("audit"),
            kind: "plan_accepted",
            actor: "orchestrator",
            summary: `Accepted planner DAG with ${plan.tasks.length} tasks`,
            createdAt: this.now(),
          });
        },
      });
      await this.runs.save(planned, run.revision);
    } catch (error) {
      const current = await this.requireRun(run.runId, run.userId);
      const failed = transitionSupervisorRun(current, {
        expectedRevision: current.revision,
        now: this.now(),
        mutate: (draft) => {
          draft.status = "needs_user";
          draft.audit.push({
            auditId: this.idFactory("audit"),
            kind: "plan_rejected",
            actor: "orchestrator",
            summary: "Planner proposal failed deterministic validation",
            createdAt: this.now(),
          });
        },
      });
      await this.runs.save(failed, current.revision);
      throw error;
    }
    return await this.schedule(planned.runId, planned.userId);
  }

  get(runId: string, userId: string): Promise<SupervisorRunState | null> {
    return this.runs.get(runId, userId);
  }

  list(input: {
    userId: string;
    projectId?: string;
    projectRoot?: string;
    includeTerminal?: boolean;
  }): Promise<SupervisorRunState[]> {
    return this.runs.list(input);
  }

  async pause(runId: string, userId: string): Promise<SupervisorRunState> {
    const run = await this.requireRun(runId, userId);
    if (run.status === "paused") {
      return run;
    }
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error(`Run ${runId} cannot be paused from ${run.status}`);
    }
    return await this.saveTransition(run, (draft) => {
      draft.status = "paused";
    });
  }

  async resume(runId: string, userId: string): Promise<SupervisorRunState> {
    const run = await this.requireRun(runId, userId);
    if (run.status !== "paused") {
      throw new Error(`Run ${runId} cannot be resumed from ${run.status}`);
    }
    const resumed = await this.saveTransition(run, (draft) => {
      draft.status = "queued";
    });
    return await this.schedule(resumed.runId, resumed.userId);
  }

  async cancel(runId: string, userId: string): Promise<SupervisorRunState> {
    const run = await this.requireRun(runId, userId);
    if (run.status === "cancelled") {
      return run;
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Run ${runId} cannot be cancelled from ${run.status}`);
    }
    const activeAttempts = collectActiveAttempts(run);
    const cancelled = await this.saveTransition(run, (draft) => {
      draft.status = "cancelled";
      for (const task of draft.tasks) {
        if (task.status !== "completed") {
          task.status = "cancelled";
        }
      }
    });
    await Promise.all(
      activeAttempts.map(async (item) => {
        await this.workers.stop({
          runId,
          userId,
          taskId: item.taskId,
          attemptId: item.attemptId,
        });
        if (item.workspace) {
          await this.workspaces.dispose(item.workspace);
        }
      })
    );
    return (await this.runs.get(runId, userId)) ?? cancelled;
  }

  async retryTask(input: {
    runId: string;
    userId: string;
    taskId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    if (task.status !== "failed" && task.status !== "needs_user") {
      throw new Error(
        `Task ${task.taskId} cannot be retried from ${task.status}`
      );
    }
    if (task.attempts.length >= run.limits.maxAttemptsPerTask) {
      throw new Error(`Task ${task.taskId} exhausted its attempt budget`);
    }
    const retried = await this.saveTransition(run, (draft) => {
      requireTask(draft, input.taskId).status = "ready";
      if (draft.status === "needs_user" || draft.status === "paused") {
        draft.status = "queued";
      }
    });
    return await this.schedule(retried.runId, retried.userId);
  }

  async replan(runId: string, userId: string): Promise<SupervisorRunState> {
    const run = await this.requireRun(runId, userId);
    if (TERMINAL_RUN_STATUSES.has(run.status) || run.status === "completing") {
      throw new Error(`Run ${runId} cannot be replanned from ${run.status}`);
    }
    if (collectActiveAttempts(run).length > 0) {
      throw new Error(
        "Active workers must finish or be cancelled before replan"
      );
    }
    if (run.plannerReplanCount >= run.limits.maxPlannerReplans) {
      throw new Error(`Run ${runId} exhausted its replan budget`);
    }
    const agents = filterEligibleAgents(
      await this.agents.listEligible({
        userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
      }),
      run.eligibleAgentIds
    );
    const completedTaskSummaries = run.tasks
      .filter((task) => task.status === "completed")
      .map((task) => ({
        taskId: task.taskId,
        summary:
          [...task.attempts].reverse().find((attempt) => attempt.result)?.result
            ?.outcomeSummary ?? "Completed with persisted evidence",
      }));
    const plan = await this.planner.replan(
      {
        runId: run.runId,
        originalIntent: run.originalIntent,
        constraints: run.constraints,
        projectRoot: run.projectRoot,
        limits: run.limits,
        agents,
        completedTaskSummaries,
      },
      run.tasks
    );
    const replanned = await this.saveTransition(run, (draft) => {
      draft.tasks = plan.tasks;
      draft.plannerReplanCount += 1;
      draft.status = "queued";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "plan_accepted",
        actor: "orchestrator",
        summary: `Accepted replan ${draft.plannerReplanCount} with ${plan.tasks.length} tasks`,
        createdAt: this.now(),
      });
    });
    return await this.schedule(replanned.runId, replanned.userId);
  }

  async approveGate(input: {
    runId: string;
    userId: string;
    gateId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const gate = requirePendingGate(run, input.gateId);
    if (
      gate.kind !== "scope" &&
      gate.kind !== "deletion" &&
      gate.kind !== "destructive_action"
    ) {
      throw new Error(`Gate ${gate.gateId} cannot be manually approved`);
    }
    const task = requireTask(run, gate.taskId);
    const attempt = requireAttempt(task, gate.attemptId);
    if (!(attempt.workspace && attempt.result)) {
      throw new Error(`Gate ${gate.gateId} has no persisted worker evidence`);
    }
    const patch = attempt.result.patch
      ? {
          workspace: attempt.workspace,
          artifact: attempt.result.patch,
          files: attempt.result.files,
        }
      : undefined;
    const decision = await this.integration.integrate({
      run,
      task,
      workspace: attempt.workspace,
      ...(patch ? { patch } : {}),
      result: attempt.result,
      approvedGateKinds: [gate.kind],
    });
    const decided = await this.saveTransition(run, (draft) => {
      const draftGate = requirePendingGate(draft, input.gateId);
      draftGate.status = "approved";
      draftGate.decidedAt = this.now();
      draftGate.decidedByUserId = input.userId;
      if (decision.decision === "allow") {
        requireTask(draft, gate.taskId).status = "completed";
      } else {
        draft.gates.push({
          gateId: this.idFactory("gate"),
          taskId: gate.taskId,
          attemptId: gate.attemptId,
          kind: mapGateKind(decision.reasons[0]),
          status: "pending",
          reason: decision.reasons.join(", "),
          createdAt: this.now(),
        });
      }
    });
    if (decision.decision !== "allow") {
      return decided;
    }
    if (decided.tasks.every((candidate) => candidate.status === "completed")) {
      return await this.finalize(decided);
    }
    const queued = await this.saveTransition(decided, (draft) => {
      draft.status = "queued";
    });
    return await this.schedule(queued.runId, queued.userId);
  }

  async rejectGate(input: {
    runId: string;
    userId: string;
    gateId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const gate = requirePendingGate(run, input.gateId);
    return await this.saveTransition(run, (draft) => {
      const draftGate = requirePendingGate(draft, input.gateId);
      draftGate.status = "rejected";
      draftGate.decidedAt = this.now();
      draftGate.decidedByUserId = input.userId;
      requireTask(draft, gate.taskId).status = "failed";
    });
  }

  async schedule(runId: string, userId: string): Promise<SupervisorRunState> {
    let run = await this.requireRun(runId, userId);
    if (run.status !== "queued" && run.status !== "running") {
      return run;
    }
    const readinessChanged = hasReadinessChange(run);
    if (readinessChanged) {
      run = await this.saveTransition(run, recomputeSupervisorTaskReadiness);
    }
    const decision = this.scheduler.evaluate(run, Date.parse(this.now()));
    if (decision.deadlineExceeded) {
      return await this.saveTransition(run, (draft) => {
        draft.status = "failed";
      });
    }
    if (decision.dispatchTaskIds.length === 0) {
      return run;
    }
    if (run.scheduleId && run.providerId && this.dispatchAdmission) {
      for (const taskId of decision.dispatchTaskIds) {
        const admission = await this.dispatchAdmission.admit({
          userId: run.userId,
          runId: run.runId,
          scheduleId: run.scheduleId,
          providerId: run.providerId,
          taskId,
        });
        if (!admission.eligible) {
          return run;
        }
      }
    }
    const prepared = new Map<string, PreparedWorkerWorkspace>();
    try {
      for (const taskId of decision.dispatchTaskIds) {
        const task = requireTask(run, taskId);
        const attemptKey = `${run.runId}:${taskId}:${task.attempts.length + 1}`;
        prepared.set(
          taskId,
          await this.workspaces.prepare({
            runId: run.runId,
            taskId,
            attemptKey,
            projectRoot: run.projectRoot,
            executionMode: task.executionMode,
            filesAllowed: task.filesAllowed,
            baseSnapshot: run.baseSnapshot,
          })
        );
      }
    } catch (error) {
      await Promise.all(
        [...prepared.values()].map((workspace) =>
          this.workspaces.dispose(workspace).catch(() => undefined)
        )
      );
      const blocked = await this.saveTransition(run, (draft) => {
        draft.status = "needs_user";
        for (const taskId of decision.dispatchTaskIds) {
          requireTask(draft, taskId).status = "needs_user";
        }
      });
      throw new SupervisorWorkspacePreparationError(blocked, error);
    }
    const dispatchIds = new Set(decision.dispatchTaskIds);
    const queued = await this.saveTransition(run, (draft) => {
      for (const task of draft.tasks) {
        if (dispatchIds.has(task.taskId)) {
          task.status = "queued";
        }
      }
    });
    await Promise.all(
      decision.dispatchTaskIds.map((taskId) => {
        const task = requireTask(queued, taskId);
        return this.workers.dispatch({
          runId: queued.runId,
          userId: queued.userId,
          taskId,
          idempotencyKey: `${queued.runId}:${taskId}:${task.attempts.length + 1}`,
          workspace: prepared.get(taskId),
        });
      })
    );
    return (await this.runs.get(runId, userId)) ?? queued;
  }

  async recordWorkerResult(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
    result: unknown;
    destructiveActions?: string[];
  }): Promise<SupervisorRunState> {
    let run = await this.requireRun(input.runId, input.userId);
    let task = requireTask(run, input.taskId);
    let attempt = requireAttempt(task, input.attemptId);
    const persistedResult = attempt.result;
    if (
      persistedResult &&
      task.status !== "reviewing" &&
      task.status !== "integrating"
    ) {
      return run;
    }

    let result =
      persistedResult ?? SupervisorWorkerResultSchema.parse(input.result);
    const workspace = attempt.workspace;
    let patch: Awaited<ReturnType<WorkerWorkspacePort["collect"]>> | undefined;
    if (task.executionMode === "write") {
      if (!workspace) {
        return await this.failResultWithoutWorkspace(
          run,
          task.taskId,
          attempt.attemptId,
          result
        );
      }
      if (persistedResult?.patch) {
        patch = {
          workspace,
          artifact: persistedResult.patch,
          files: persistedResult.files,
        };
      } else {
        patch = await this.workspaces.collect(workspace);
        result = SupervisorWorkerResultSchema.parse({
          ...result,
          files: patch.files,
          patch: patch.artifact,
        });
      }
    }
    if (!persistedResult) {
      const assessment = this.results.assess({ task, attempt, result });
      run = await this.saveTransition(run, (draft) => {
        const draftTask = requireTask(draft, input.taskId);
        const draftAttempt = requireAttempt(draftTask, input.attemptId);
        draftAttempt.status = "terminal";
        draftAttempt.finishedAt = result.finishedAt;
        draftAttempt.result = result;
        if (assessment.decision === "accept") {
          draftTask.status = "reviewing";
        } else {
          draftTask.status = "needs_user";
          draft.status = "needs_user";
        }
      });
      if (assessment.decision !== "accept") {
        if (workspace) {
          await this.workspaces.dispose(workspace);
        }
        return run;
      }
    }

    task = requireTask(run, input.taskId);
    attempt = requireAttempt(task, input.attemptId);
    if (!workspace) {
      throw new Error(
        `Worker attempt ${attempt.attemptId} has no workspace evidence`
      );
    }
    if (task.executionMode === "write" && task.status !== "integrating") {
      run = await this.saveTransition(run, (draft) => {
        requireTask(draft, input.taskId).status = "integrating";
      });
      task = requireTask(run, input.taskId);
    }
    const gate = await this.integration.integrate({
      run,
      task,
      workspace,
      ...(patch ? { patch } : {}),
      result,
      ...(input.destructiveActions
        ? { destructiveActions: input.destructiveActions }
        : {}),
    });
    run = await this.saveTransition(run, (draft) => {
      const draftTask = requireTask(draft, input.taskId);
      if (gate.decision === "allow") {
        draftTask.status = "completed";
      } else {
        draftTask.status = "needs_user";
        draft.status = "needs_user";
        draft.gates.push({
          gateId: this.idFactory("gate"),
          taskId: input.taskId,
          attemptId: input.attemptId,
          kind: mapGateKind(gate.reasons[0]),
          status: "pending",
          reason: gate.reasons.join(", "),
          createdAt: this.now(),
        });
      }
    });
    if (gate.decision !== "allow") {
      return run;
    }
    if (run.tasks.every((candidate) => candidate.status === "completed")) {
      return await this.finalize(run);
    }
    return await this.schedule(run.runId, run.userId);
  }

  async recordWorkerTerminal(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
    action: "done" | "needs_user" | "abort";
    reason: string;
    resultText: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    const attempt = requireAttempt(task, input.attemptId);
    if (attempt.result) {
      return run;
    }
    let result: unknown;
    if (input.action === "done") {
      try {
        result = extractWorkerResult(input.resultText);
      } catch {
        result = createTerminalFailureResult({
          attempt,
          status: "needs_user",
          reason: "Worker completion lacked a valid structured result",
          now: this.now(),
        });
      }
    } else {
      result = createTerminalFailureResult({
        attempt,
        status: input.action === "needs_user" ? "needs_user" : "failed",
        reason: input.reason,
        now: this.now(),
      });
    }
    return await this.recordWorkerResult({
      runId: input.runId,
      userId: input.userId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      result,
    });
  }

  private async failResultWithoutWorkspace(
    run: SupervisorRunState,
    taskId: string,
    attemptId: string,
    result: ReturnType<typeof SupervisorWorkerResultSchema.parse>
  ): Promise<SupervisorRunState> {
    return await this.saveTransition(run, (draft) => {
      const task = requireTask(draft, taskId);
      const attempt = requireAttempt(task, attemptId);
      attempt.status = "terminal";
      attempt.finishedAt = result.finishedAt;
      attempt.result = result;
      task.status = "needs_user";
      draft.status = "needs_user";
    });
  }

  private async finalize(run: SupervisorRunState): Promise<SupervisorRunState> {
    let completing = await this.saveTransition(run, (draft) => {
      draft.status = "completing";
    });
    const commands = [
      ...new Set(completing.tasks.flatMap((task) => task.verificationCommands)),
    ];
    if (commands.length === 0) {
      return await this.saveTransition(completing, (draft) => {
        draft.status = "needs_user";
      });
    }
    const evidence = await this.finalVerifier.verify({
      projectRoot: completing.projectRoot,
      commands,
    });
    const passed = commands.every((command) =>
      evidence.some((item) => item.command === command && item.exitCode === 0)
    );
    completing = await this.saveTransition(completing, (draft) => {
      draft.finalVerification = evidence;
      draft.status = passed ? "completed" : "needs_user";
    });
    return completing;
  }

  private async saveTransition(
    run: SupervisorRunState,
    mutate: (draft: SupervisorRunState) => void
  ): Promise<SupervisorRunState> {
    const next = transitionSupervisorRun(run, {
      expectedRevision: run.revision,
      now: this.now(),
      mutate,
    });
    return await this.runs.save(next, run.revision);
  }

  private async requireRun(
    runId: string,
    userId: string
  ): Promise<SupervisorRunState> {
    const run = await this.runs.get(runId, userId);
    if (!run) {
      throw new Error(`Supervisor run not found: ${runId}`);
    }
    return run;
  }
}

export class SupervisorWorkspacePreparationError extends Error {
  readonly run: SupervisorRunState;

  constructor(run: SupervisorRunState, cause: unknown) {
    super("Worker workspace preparation failed closed", { cause });
    this.name = "SupervisorWorkspacePreparationError";
    this.run = run;
  }
}

function requireTask(
  run: SupervisorRunState,
  taskId: string
): SupervisorTaskRecord {
  const task = run.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new Error(`Supervisor task not found: ${taskId}`);
  }
  return task;
}

function requireAttempt(task: SupervisorTaskRecord, attemptId: string) {
  const attempt = task.attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Supervisor attempt not found: ${attemptId}`);
  }
  return attempt;
}

function requirePendingGate(run: SupervisorRunState, gateId: string) {
  const gate = run.gates.find((candidate) => candidate.gateId === gateId);
  if (!gate) {
    throw new Error(`Supervisor gate not found: ${gateId}`);
  }
  if (gate.status !== "pending") {
    throw new Error(`Supervisor gate ${gateId} is already ${gate.status}`);
  }
  return gate;
}

function mapGateKind(
  reason: string | undefined
): SupervisorRunState["gates"][number]["kind"] {
  switch (reason) {
    case "scope_drift":
      return "scope";
    case "dirty_path_overlap":
      return "dirty_overlap";
    case "baseline_drift":
      return "baseline_drift";
    case "file_deleted":
      return "deletion";
    case "destructive_action":
      return "destructive_action";
    case "verification_failed":
      return "verification";
    case "conflict":
      return "conflict";
    default:
      return "verification";
  }
}

function hasReadinessChange(run: SupervisorRunState): boolean {
  const copy = structuredClone(run);
  recomputeSupervisorTaskReadiness(copy);
  return copy.tasks.some(
    (task, index) => task.status !== run.tasks[index]?.status
  );
}

function collectActiveAttempts(run: SupervisorRunState) {
  return run.tasks.flatMap((task) =>
    task.attempts
      .filter(
        (attempt) =>
          attempt.status === "starting" || attempt.status === "running"
      )
      .map((attempt) => ({
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        workspace: attempt.workspace,
      }))
  );
}

function createTerminalFailureResult(input: {
  attempt: ReturnType<typeof requireAttempt>;
  status: "needs_user" | "failed";
  reason: string;
  now: string;
}) {
  return {
    semanticStatus: input.status,
    reason: input.reason,
    outcomeSummary: input.reason,
    files: { touched: [], created: [], deleted: [], renamed: [] },
    verification: [],
    toolFailureSummary: [],
    unresolvedPermissions: [],
    agentId: input.attempt.agentId,
    chatId: input.attempt.chatId,
    ...(input.attempt.agentSessionId
      ? { agentSessionId: input.attempt.agentSessionId }
      : {}),
    startedAt: input.attempt.startedAt,
    finishedAt: input.now,
  };
}

function filterEligibleAgents(
  agents: SupervisorPlannerAgent[],
  eligibleAgentIds: string[] | undefined
): SupervisorPlannerAgent[] {
  if (!eligibleAgentIds || eligibleAgentIds.length === 0) {
    return agents;
  }
  const allowed = new Set(eligibleAgentIds);
  return agents.filter((agent) => allowed.has(agent.agentId));
}
