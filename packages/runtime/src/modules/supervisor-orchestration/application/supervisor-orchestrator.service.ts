import { createId } from "#runtime/shared/utils/id.util";
import {
  computeSupervisorPlanHash,
  isReplanInsideApprovedEnvelope,
  supervisorPlanHashMatches,
} from "../domain/supervisor-plan-hash";
import {
  createDefaultSupervisorRunLimits,
  type SupervisorExecutionEnvelope,
  type SupervisorRunState,
  SupervisorRunStateSchema,
  type SupervisorTaskRecord,
  SupervisorWorkerResultSchema,
} from "../domain/supervisor-run.schemas";
import {
  recomputeSupervisorTaskReadiness,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import type { AcpManagerSessionCoordinator } from "./acp-manager-session-coordinator.service";
import type {
  AcpManagerPlanTurn,
  AcpManagerTurn,
} from "./contracts/acp-manager-turn.contract";
import type { SupervisorPlannerAgent } from "./contracts/supervisor-planner.contract";
import type {
  CreateSupervisorRunDraftInput,
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
import type { SupervisorFinalCommitService } from "./supervisor-final-commit.service";
import type { SupervisorPlannerService } from "./supervisor-planner.service";
import type { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import type { WorkerIntegrationService } from "./worker-integration.service";
import { extractWorkerResult } from "./worker-result.extractor";
import type { WorkerResultService } from "./worker-result.service";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface SupervisorOrchestratorDeps {
  runs: SupervisorRunRepositoryPort;
  planner: Pick<SupervisorPlannerService, "plan" | "replan"> &
    Partial<Pick<SupervisorPlannerService, "validateProposal">>;
  manager?: Pick<AcpManagerSessionCoordinator, "dispatch" | "stop">;
  agentCapacity?: {
    admit(input: {
      userId: string;
      projectId?: string;
      agentId: string;
      overnight?: boolean;
    }): Promise<{ eligible: boolean; reason?: string }>;
  };
  scheduler: SupervisorSchedulerService;
  workers: WorkerSessionManagerPort;
  agents: SupervisorAgentCatalogPort;
  baseSnapshot: SupervisorBaseSnapshotPort;
  workspaces: WorkerWorkspacePort;
  integration: Pick<WorkerIntegrationService, "integrate">;
  results: WorkerResultService;
  finalVerifier: SupervisorFinalVerifierPort;
  finalCommit?: Pick<SupervisorFinalCommitService, "commit">;
  configuredLimits?: Partial<
    ReturnType<typeof createDefaultSupervisorRunLimits>
  >;
  now?: () => string;
  createId?: (prefix: string) => string;
}

export class SupervisorOrchestratorService {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly planner: Pick<SupervisorPlannerService, "plan" | "replan"> &
    Partial<Pick<SupervisorPlannerService, "validateProposal">>;
  private readonly manager?: Pick<
    AcpManagerSessionCoordinator,
    "dispatch" | "stop"
  >;
  private readonly agentCapacity?: SupervisorOrchestratorDeps["agentCapacity"];
  private readonly scheduler: SupervisorSchedulerService;
  private readonly workers: WorkerSessionManagerPort;
  private readonly agents: SupervisorAgentCatalogPort;
  private readonly baseSnapshot: SupervisorBaseSnapshotPort;
  private readonly workspaces: WorkerWorkspacePort;
  private readonly integration: Pick<WorkerIntegrationService, "integrate">;
  private readonly results: WorkerResultService;
  private readonly finalVerifier: SupervisorFinalVerifierPort;
  private readonly finalCommit?: Pick<SupervisorFinalCommitService, "commit">;
  private readonly configuredLimits: Partial<
    ReturnType<typeof createDefaultSupervisorRunLimits>
  >;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private dispatchAdmission?: SupervisorDispatchAdmissionPort;
  private globalSchedule?: () => Promise<unknown>;

  constructor(deps: SupervisorOrchestratorDeps) {
    this.runs = deps.runs;
    this.planner = deps.planner;
    this.manager = deps.manager;
    this.agentCapacity = deps.agentCapacity;
    this.scheduler = deps.scheduler;
    this.workers = deps.workers;
    this.agents = deps.agents;
    this.baseSnapshot = deps.baseSnapshot;
    this.workspaces = deps.workspaces;
    this.integration = deps.integration;
    this.results = deps.results;
    this.finalVerifier = deps.finalVerifier;
    this.finalCommit = deps.finalCommit;
    this.configuredLimits = deps.configuredLimits ?? {};
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
  }

  setDispatchAdmission(port: SupervisorDispatchAdmissionPort): void {
    this.dispatchAdmission = port;
  }

  setGlobalScheduler(schedule: () => Promise<unknown>): void {
    this.globalSchedule = schedule;
  }

  start(input: CreateSupervisorRunDraftInput): Promise<SupervisorRunState> {
    return this.createDraft(input);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Draft creation intentionally keeps fail-closed planning transitions in one audited transaction flow.
  async createDraft(
    input: CreateSupervisorRunDraftInput
  ): Promise<SupervisorRunState> {
    const now = this.now();
    const intent = input.intent?.trim() || input.originalIntent?.trim();
    if (!intent) {
      throw new Error("Supervisor goal intent is required");
    }
    const agentAllowlist = input.agentAllowlist ?? input.eligibleAgentIds;
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
      maxPlannerReplans: Math.min(
        requested.maxPlannerReplans,
        configured.maxPlannerReplans
      ),
    };
    const run = SupervisorRunStateSchema.parse({
      schemaVersion: 2,
      runId: this.idFactory("supervisor-run"),
      revision: 0,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      projectRoot: input.projectRoot,
      ...(input.scheduleId || input.providerId || input.workerModelId
        ? {
            legacyAutomation: {
              ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
              ...(input.providerId ? { providerId: input.providerId } : {}),
              ...(input.workerModelId
                ? { workerModelId: input.workerModelId }
                : {}),
            },
          }
        : {}),
      ...(agentAllowlist
        ? { agentAllowlist: [...new Set(agentAllowlist)] }
        : {}),
      originalIntent: intent,
      constraints: input.constraints ?? [],
      priority: input.priority ?? "normal",
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
      capacityWaits: [],
      decisions: [],
      plannerReplanCount: 0,
      finalVerification: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.runs.create(run);

    try {
      const agents = filterEligibleAgents(
        await this.agents.listEligible({
          userId: input.userId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        }),
        agentAllowlist
      );
      if (agents.length === 0) {
        throw new Error("No configured agent satisfies the run restriction.");
      }
      const managerAgent =
        agents.find(
          (agent) =>
            agent.managerEligible &&
            (!input.scheduleId || agent.overnightEligible === true)
        ) ??
        (agents.every((agent) => agent.managerEligible === undefined)
          ? agents[0]
          : undefined);
      if (!managerAgent) {
        throw new Error("No configured manager agent is available");
      }
      if (this.manager) {
        return await this.manager.dispatch({
          runId: run.runId,
          userId: run.userId,
          managerAgentId: managerAgent.agentId,
          turnKind: "plan",
          ...(input.projectIndexSummary
            ? { projectIndexSummary: input.projectIndexSummary }
            : {}),
          ...(input.scopeResolutionSummary
            ? { scopeResolutionSummary: input.scopeResolutionSummary }
            : {}),
        });
      }
      const legacyPlan = await this.planner.plan({
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
      return await this.persistProposedPlan(
        run,
        {
          schemaVersion: 1,
          kind: "plan",
          summary: legacyPlan.proposal.summary,
          risks: [],
          tasks: legacyPlan.proposal.tasks,
          envelope: buildLegacyEnvelope(run, legacyPlan.tasks),
        },
        legacyPlan.tasks
      );
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

  async recordManagerTurn(input: {
    runId: string;
    userId: string;
    turn: AcpManagerTurn;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const turn = input.turn;
    if (turn.kind === "plan" || turn.kind === "replan") {
      try {
        return await this.persistProposedPlan(run, turn);
      } catch (error) {
        const current = await this.requireRun(input.runId, input.userId);
        if (current.status !== "planning") {
          throw error;
        }
        const reason =
          error instanceof Error
            ? error.message
            : "Manager proposal failed deterministic validation";
        return await this.saveTransition(current, (draft) => {
          draft.status = "needs_user";
          if (
            !draft.decisions.some(
              (decision) =>
                decision.status === "open" &&
                decision.kind === "classifier_uncertain"
            )
          ) {
            draft.decisions.push({
              decisionId: this.idFactory("decision"),
              kind: "classifier_uncertain",
              status: "open",
              prompt: `Manager proposal was rejected: ${reason}`,
              createdAt: this.now(),
            });
          }
          draft.audit.push({
            auditId: this.idFactory("audit"),
            kind: "plan_rejected",
            actor: "orchestrator",
            summary: "Manager proposal failed deterministic validation",
            createdAt: this.now(),
          });
        });
      }
    }
    if (turn.kind === "question") {
      return await this.saveTransition(run, (draft) => {
        draft.status = "needs_user";
        draft.decisions.push({
          decisionId: this.idFactory("decision"),
          kind: turn.decisionKind,
          status: "open",
          prompt: turn.prompt,
          createdAt: this.now(),
        });
        draft.audit.push({
          auditId: this.idFactory("audit"),
          kind: "decision_opened",
          actor: "orchestrator",
          summary: `Manager requested ${turn.decisionKind}`,
          createdAt: this.now(),
        });
      });
    }
    if (turn.kind === "continue") {
      return run.status === "queued" || run.status === "running"
        ? await this.scheduleFair(run)
        : run;
    }
    if (
      run.status === "completing" &&
      run.finalVerification.length > 0 &&
      run.finalVerification.every((item) => item.exitCode === 0)
    ) {
      return await this.saveTransition(run, (draft) => {
        draft.audit.push({
          auditId: this.idFactory("audit"),
          kind: "final_verification_recorded",
          actor: "orchestrator",
          summary: turn.summary,
          createdAt: this.now(),
        });
      });
    }
    return await this.saveTransition(run, (draft) => {
      draft.status = "needs_user";
      draft.decisions.push({
        decisionId: this.idFactory("decision"),
        kind: "classifier_uncertain",
        status: "open",
        prompt:
          "Manager attempted completion before deterministic evidence was ready",
        createdAt: this.now(),
      });
    });
  }

  async approvePlan(input: {
    runId: string;
    userId: string;
    planVersion: number;
    planHash: string;
    expectedRevision: number;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    if (run.revision !== input.expectedRevision) {
      throw new Error(
        `Supervisor run revision changed: expected ${input.expectedRevision}, actual ${run.revision}`
      );
    }
    if (run.status !== "awaiting_approval" || !run.plan) {
      throw new Error(`Run ${run.runId} has no plan awaiting approval`);
    }
    if (
      run.plan.version !== input.planVersion ||
      run.plan.hash !== input.planHash ||
      !supervisorPlanHashMatches(input.planHash, {
        version: run.plan.version,
        summary: run.plan.summary,
        envelope: run.plan.envelope,
        tasks: run.tasks,
      })
    ) {
      throw new Error(
        "Plan version/hash does not match the persisted proposal"
      );
    }
    const approved = await this.saveTransition(run, (draft) => {
      if (!draft.plan) {
        throw new Error("Plan disappeared during approval");
      }
      draft.plan.approvedAt = this.now();
      draft.plan.approvedByUserId = input.userId;
      draft.status = "queued";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "plan_approved",
        actor: "user",
        summary: `Approved plan v${input.planVersion} ${input.planHash.slice(0, 12)}`,
        createdAt: this.now(),
      });
    });
    return await this.scheduleFair(approved);
  }

  async requestPlanChanges(input: {
    runId: string;
    userId: string;
    requestedChanges: string;
    expectedRevision: number;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    if (run.revision !== input.expectedRevision) {
      throw new Error("Supervisor run revision changed before plan changes");
    }
    if (run.status !== "awaiting_approval") {
      throw new Error(`Run ${run.runId} is not awaiting plan approval`);
    }
    const manager = run.managerSession;
    if (!(this.manager && manager)) {
      throw new Error("ACP manager session is unavailable for plan changes");
    }
    const planning = await this.saveTransition(run, (draft) => {
      draft.status = "planning";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "plan_changes_requested",
        actor: "user",
        summary: input.requestedChanges,
        createdAt: this.now(),
      });
    });
    return await this.manager.dispatch({
      runId: planning.runId,
      userId: planning.userId,
      managerAgentId: manager.agentId,
      turnKind: "replan",
      requestedChanges: input.requestedChanges,
    });
  }

  async answerDecision(input: {
    runId: string;
    userId: string;
    decisionId: string;
    answer: string;
    expectedRevision: number;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    if (run.revision !== input.expectedRevision) {
      throw new Error("Supervisor run revision changed before decision answer");
    }
    const decision = run.decisions.find(
      (candidate) => candidate.decisionId === input.decisionId
    );
    if (!decision || decision.status !== "open") {
      throw new Error(`Manager decision is not open: ${input.decisionId}`);
    }
    const retryFinalDelivery = isFinalDeliveryRetry(run, decision.decisionId);
    const answered = await this.saveTransition(run, (draft) => {
      const target = draft.decisions.find(
        (candidate) => candidate.decisionId === input.decisionId
      );
      if (!target || target.status !== "open") {
        throw new Error("Manager decision changed before answer persistence");
      }
      target.status = "answered";
      target.answer = input.answer;
      target.answeredAt = this.now();
      target.answeredByUserId = input.userId;
      draft.status = retryFinalDelivery ? "needs_user" : "planning";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: "decision_answered",
        actor: "user",
        summary: `Answered manager decision ${input.decisionId}`,
        createdAt: this.now(),
      });
    });
    if (retryFinalDelivery) {
      return await this.finalize(answered);
    }
    const manager = answered.managerSession;
    if (!(this.manager && manager)) {
      return answered;
    }
    return await this.manager.dispatch({
      runId: answered.runId,
      userId: answered.userId,
      managerAgentId: manager.agentId,
      turnKind: "replan",
      requestedChanges: input.answer,
    });
  }

  async setPriority(input: {
    runId: string;
    userId: string;
    priority: SupervisorRunState["priority"];
    expectedRevision: number;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    if (run.revision !== input.expectedRevision) {
      throw new Error("Supervisor run revision changed before priority update");
    }
    return await this.saveTransition(run, (draft) => {
      draft.priority = input.priority;
    });
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
    return await this.scheduleFair(resumed);
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
    await this.manager?.stop({ runId, userId });
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
    return await this.scheduleFair(retried);
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
    if (this.manager && run.managerSession) {
      const planning = await this.saveTransition(run, (draft) => {
        draft.status = "planning";
      });
      return await this.manager.dispatch({
        runId: planning.runId,
        userId: planning.userId,
        managerAgentId: run.managerSession.agentId,
        turnKind: "replan",
      });
    }
    const agents = filterEligibleAgents(
      await this.agents.listEligible({
        userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
      }),
      run.agentAllowlist
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
    return await this.persistProposedPlan(
      run,
      {
        schemaVersion: 1,
        kind: "replan",
        summary: plan.proposal.summary,
        risks: [],
        tasks: plan.proposal.tasks,
        envelope: buildLegacyEnvelope(run, plan.tasks),
      },
      plan.tasks
    );
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
    return await this.scheduleFair(queued);
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Dispatch admission, capacity, and workspace fail-closed branches form one state-machine transition.
  async schedule(
    runId: string,
    userId: string,
    maxDispatches?: number
  ): Promise<SupervisorRunState> {
    let run = await this.requireRun(runId, userId);
    if (run.status !== "queued" && run.status !== "running") {
      return run;
    }
    const readinessChanged = hasReadinessChange(run);
    if (readinessChanged) {
      run = await this.saveTransition(run, recomputeSupervisorTaskReadiness);
    }
    const evaluated = this.scheduler.evaluate(run);
    let decision = {
      ...evaluated,
      dispatchTaskIds:
        maxDispatches === undefined
          ? evaluated.dispatchTaskIds
          : evaluated.dispatchTaskIds.slice(0, Math.max(0, maxDispatches)),
    };
    if (this.agentCapacity && decision.dispatchTaskIds.length > 0) {
      const admitted: string[] = [];
      for (const taskId of decision.dispatchTaskIds) {
        const task = requireTask(run, taskId);
        if (!task.preferredAgentId) {
          continue;
        }
        const capacity = await this.agentCapacity.admit({
          userId: run.userId,
          ...(run.projectId ? { projectId: run.projectId } : {}),
          agentId: task.preferredAgentId,
          overnight: Boolean(run.legacyAutomation?.scheduleId),
        });
        if (capacity.eligible) {
          admitted.push(taskId);
        }
      }
      decision = { ...decision, dispatchTaskIds: admitted };
    }
    if (decision.dispatchTaskIds.length === 0) {
      return run;
    }
    const scheduleId = run.legacyAutomation?.scheduleId;
    const providerId = run.legacyAutomation?.providerId;
    if (scheduleId && providerId && this.dispatchAdmission) {
      for (const taskId of decision.dispatchTaskIds) {
        const admission = await this.dispatchAdmission.admit({
          userId: run.userId,
          runId: run.runId,
          scheduleId,
          providerId,
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
    await this.workers.release({
      runId: run.runId,
      userId: run.userId,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
    });
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
    const deliveryFingerprints =
      gate.decision === "allow" && task.executionMode === "write"
        ? await this.workspaces.fingerprint({
            projectRoot: run.projectRoot,
            relativePaths: result.files.touched,
          })
        : {};
    run = await this.saveTransition(run, (draft) => {
      const draftTask = requireTask(draft, input.taskId);
      if (gate.decision === "allow") {
        draftTask.status = "completed";
        Object.assign(draft.deliveryFingerprints, deliveryFingerprints);
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
    return await this.scheduleFair(run);
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

  private async persistProposedPlan(
    run: SupervisorRunState,
    turn: AcpManagerPlanTurn,
    prevalidatedLegacyTasks?: SupervisorTaskRecord[]
  ): Promise<SupervisorRunState> {
    const validateProposal = this.planner.validateProposal;
    if (!(validateProposal || prevalidatedLegacyTasks)) {
      throw new Error("Deterministic manager plan validation is unavailable");
    }
    const agents = filterEligibleAgents(
      await this.agents.listEligible({
        userId: run.userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
      }),
      run.agentAllowlist
    );
    const validatedTasks =
      prevalidatedLegacyTasks ??
      validateProposal?.call(
        this.planner,
        {
          runId: run.runId,
          originalIntent: run.originalIntent,
          constraints: run.constraints,
          projectRoot: run.projectRoot,
          limits: run.limits,
          agents,
          completedTaskSummaries: run.tasks
            .filter((task) => task.status === "completed")
            .map((task) => ({
              taskId: task.taskId,
              summary:
                [...task.attempts].reverse().find((attempt) => attempt.result)
                  ?.result?.outcomeSummary ??
                "Completed with persisted evidence",
            })),
        },
        {
          schemaVersion: 1,
          summary: turn.summary,
          tasks: turn.tasks,
        }
      ).tasks;
    if (!validatedTasks) {
      throw new Error("Deterministic manager plan validation is unavailable");
    }
    assertManagerEnvelope(run, turn.envelope, validatedTasks);
    const version = (run.plan?.version ?? 0) + 1;
    const hash = computeSupervisorPlanHash({
      version,
      summary: turn.summary,
      envelope: turn.envelope,
      tasks: validatedTasks,
    });
    const autoApproved = Boolean(
      turn.kind === "replan" &&
        run.plan?.approvedAt &&
        isReplanInsideApprovedEnvelope({
          approved: run.plan.envelope,
          proposed: turn.envelope,
        })
    );
    const proposed = await this.saveTransition(run, (draft) => {
      draft.tasks = validatedTasks;
      if (turn.kind === "replan") {
        draft.plannerReplanCount += 1;
      }
      draft.plan = {
        version,
        hash,
        summary: turn.summary,
        envelope: turn.envelope,
        ...(autoApproved && run.plan?.approvedAt && run.plan.approvedByUserId
          ? {
              approvedAt: run.plan.approvedAt,
              approvedByUserId: run.plan.approvedByUserId,
            }
          : {}),
      };
      draft.status = autoApproved ? "queued" : "awaiting_approval";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: autoApproved ? "plan_accepted" : "plan_awaiting_approval",
        actor: "orchestrator",
        summary: `${autoApproved ? "Auto-approved" : "Proposed"} plan v${version} ${hash.slice(0, 12)}`,
        createdAt: this.now(),
      });
    });
    return autoApproved ? await this.scheduleFair(proposed) : proposed;
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
      draft.status = passed ? "completing" : "needs_user";
    });
    if (!passed) {
      return completing;
    }
    if (!this.finalCommit) {
      return await this.saveTransition(completing, (draft) => {
        draft.status = "completed";
      });
    }
    try {
      const committed = await this.finalCommit.commit(completing);
      return await this.saveTransition(completing, (draft) => {
        draft.finalCommitSha = committed.commitSha;
        draft.status = "completed";
        draft.audit.push({
          auditId: this.idFactory("audit"),
          kind: "final_commit_created",
          actor: "orchestrator",
          summary: `Created scoped final commit ${committed.commitSha.slice(0, 12)}`,
          metadata: { safetyRef: committed.safetyRef },
          createdAt: this.now(),
        });
      });
    } catch (error) {
      return await this.saveTransition(completing, (draft) => {
        draft.status = "needs_user";
        draft.decisions.push({
          decisionId: this.idFactory("decision"),
          kind: "baseline_drift",
          status: "open",
          prompt:
            error instanceof Error
              ? error.message
              : "Final scoped commit failed closed",
          createdAt: this.now(),
        });
        draft.audit.push({
          auditId: this.idFactory("audit"),
          kind: "decision_opened",
          actor: "orchestrator",
          summary: "Final scoped commit requires user review",
          createdAt: this.now(),
        });
      });
    }
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

  private async scheduleFair(
    run: SupervisorRunState
  ): Promise<SupervisorRunState> {
    if (!this.globalSchedule) {
      return await this.schedule(run.runId, run.userId);
    }
    await this.globalSchedule();
    return await this.requireRun(run.runId, run.userId);
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

function isFinalDeliveryRetry(
  run: SupervisorRunState,
  decisionId: string
): boolean {
  const decision = run.decisions.find(
    (candidate) => candidate.decisionId === decisionId
  );
  return Boolean(
    run.status === "needs_user" &&
      decision?.kind === "baseline_drift" &&
      run.tasks.length > 0 &&
      run.tasks.every((task) => task.status === "completed") &&
      !run.gates.some((gate) => gate.status === "pending") &&
      run.plan?.approvedAt &&
      run.plan.approvedByUserId &&
      run.plan.envelope.delivery.createCommit
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

function assertManagerEnvelope(
  run: SupervisorRunState,
  envelope: SupervisorExecutionEnvelope,
  tasks: SupervisorTaskRecord[]
): void {
  if (envelope.goal !== run.originalIntent) {
    throw new Error("Manager plan changed the authoritative goal");
  }
  if (
    run.managerSession &&
    (!(run.baseSnapshot.branch && run.baseSnapshot.head) ||
      envelope.delivery.targetBranch !== run.baseSnapshot.branch ||
      envelope.delivery.targetHead !== run.baseSnapshot.head)
  ) {
    throw new Error(
      "Manager delivery branch/HEAD does not match the captured project state"
    );
  }
  const allowedFiles = new Set(envelope.fileScopes);
  for (const file of tasks.flatMap((task) => task.filesAllowed)) {
    if (!allowedFiles.has(file)) {
      throw new Error(
        `Manager task file is outside the plan envelope: ${file}`
      );
    }
  }
}

function buildLegacyEnvelope(
  run: SupervisorRunState,
  tasks: SupervisorTaskRecord[]
): SupervisorExecutionEnvelope {
  return {
    goal: run.originalIntent,
    fileScopes: [...new Set(tasks.flatMap((task) => task.filesAllowed))],
    verificationCommands: [
      ...new Set(tasks.flatMap((task) => task.verificationCommands)),
    ],
    successCriteria: ["All deterministic task and aggregate gates pass"],
    permissionScopes: ["project-root-sandbox", "existing-command-allowlists"],
    destructiveActions: [],
    delivery: {
      createCommit: true,
      targetBranch: run.baseSnapshot.branch ?? "HEAD",
      targetHead: run.baseSnapshot.head ?? "unborn",
      allowDefaultBranch: false,
    },
  };
}
