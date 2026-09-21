import { CryptoHasher } from "bun";
import { createId } from "#runtime/shared/utils/id.util";
import {
  computeSupervisorPlanHash,
  isReplanInsideApprovedEnvelope,
  supervisorPlanHashMatches,
} from "../domain/supervisor-plan-hash";
import {
  assessGoalContractCriteria,
  createDefaultSupervisorRunLimits,
  isActiveSupervisorAttemptStatus,
  SUPERVISOR_RUN_SCHEMA_VERSION,
  type SupervisorExecutionEnvelope,
  type SupervisorRunState,
  SupervisorRunStateSchema,
  type SupervisorTaskRecord,
  type SupervisorWorkerAttempt,
  SupervisorWorkerResultSchema,
} from "../domain/supervisor-run.schemas";
import { transitionSupervisorRun } from "../domain/supervisor-run.transitions";
import type { AcpManagerSessionCoordinator } from "./acp-manager-session-coordinator.service";
import type {
  AcpManagerPlanTurn,
  AcpManagerTurn,
} from "./contracts/acp-manager-turn.contract";
import type { SupervisorPlannerAgent } from "./contracts/supervisor-planner.contract";
import type { PreparedSupervisorPrompt } from "./ports/supervisor-effect-prompt-dispatch.port";
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
import {
  normalizeSafeRelativePath,
  type SupervisorPlannerService,
} from "./supervisor-planner.service";
import type { SupervisorSchedulerService } from "./supervisor-scheduler.service";
import {
  SupervisorWorkflowRunBoundary,
  type SupervisorWorkflowRunBoundaryPort,
} from "./supervisor-workflow-run-boundary";
import type { WorkerIntegrationService } from "./worker-integration.service";
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
  workflowRunBoundary?: SupervisorWorkflowRunBoundaryPort;
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
  private readonly workers: WorkerSessionManagerPort;
  private readonly agents: SupervisorAgentCatalogPort;
  private readonly baseSnapshot: SupervisorBaseSnapshotPort;
  private readonly workspaces: WorkerWorkspacePort;
  private readonly results: WorkerResultService;
  private readonly configuredLimits: Partial<
    ReturnType<typeof createDefaultSupervisorRunLimits>
  >;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly workflowRunBoundary: SupervisorWorkflowRunBoundaryPort;
  private dispatchAdmission?: SupervisorDispatchAdmissionPort;
  private globalSchedule?: () => Promise<unknown>;
  private workflowPump?: (
    runId: string,
    userId: string
  ) => Promise<SupervisorRunState>;

  constructor(deps: SupervisorOrchestratorDeps) {
    this.runs = deps.runs;
    this.planner = deps.planner;
    this.manager = deps.manager;
    this.agentCapacity = deps.agentCapacity;
    this.workers = deps.workers;
    this.agents = deps.agents;
    this.baseSnapshot = deps.baseSnapshot;
    this.workspaces = deps.workspaces;
    this.results = deps.results;
    this.configuredLimits = deps.configuredLimits ?? {};
    this.now = deps.now ?? (() => new Date().toISOString());
    this.idFactory = deps.createId ?? createId;
    this.workflowRunBoundary =
      deps.workflowRunBoundary ?? new SupervisorWorkflowRunBoundary();
  }

  setDispatchAdmission(port: SupervisorDispatchAdmissionPort): void {
    this.dispatchAdmission = port;
  }

  setGlobalScheduler(schedule: () => Promise<unknown>): void {
    this.globalSchedule = schedule;
  }

  setWorkflowPump(
    pump: (runId: string, userId: string) => Promise<SupervisorRunState>
  ): void {
    this.workflowPump = pump;
  }

  start(input: CreateSupervisorRunDraftInput): Promise<SupervisorRunState> {
    return this.createDraft(input);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Draft creation keeps source-bound idempotency, immutable snapshot capture, and the legacy no-pump compatibility path in one auditable boundary.
  async createDraft(
    input: CreateSupervisorRunDraftInput
  ): Promise<SupervisorRunState> {
    const sourceGoalContract = input.sourceGoalContract;
    const sourceRunId = sourceGoalContract
      ? createSourceGoalRunId(input.userId, sourceGoalContract.intakeId)
      : undefined;
    if (sourceGoalContract && sourceRunId) {
      const existing = await this.findSourceGoalRun(
        input,
        sourceGoalContract,
        sourceRunId
      );
      if (existing) {
        return await this.pumpExistingSourceRun(
          requireExactSourceGoalBinding(existing, input, sourceGoalContract)
        );
      }
    }
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
    const runId = sourceRunId ?? this.idFactory("supervisor-run");
    const run = SupervisorRunStateSchema.parse({
      schemaVersion: SUPERVISOR_RUN_SCHEMA_VERSION,
      runId,
      revision: 0,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      projectRoot: input.projectRoot,
      ...(input.sourceGoalContract
        ? { sourceGoalContract: structuredClone(input.sourceGoalContract) }
        : {}),
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
      desiredState: "running",
      phase: "planning",
      activity: "planning",
      workflowPlan: {
        goalRevisionId:
          input.sourceGoalContract?.revisionId ?? `${runId}-goal-1`,
        authorityId: `${runId}-authority-1`,
        status: "missing",
      },
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
    try {
      await this.runs.create(run);
    } catch (error) {
      if (sourceGoalContract && sourceRunId) {
        const raced = await this.findSourceGoalRun(
          input,
          sourceGoalContract,
          sourceRunId
        );
        if (raced) {
          return await this.pumpExistingSourceRun(
            requireExactSourceGoalBinding(raced, input, sourceGoalContract)
          );
        }
      }
      throw error;
    }

    if (this.workflowPump) {
      return await this.workflowPump(run.runId, run.userId);
    }

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
      const legacyPlan = await this.planner.plan({
        runId: run.runId,
        originalIntent: run.originalIntent,
        constraints: run.constraints,
        projectRoot: run.projectRoot,
        limits: run.limits,
        agents,
        ...(run.sourceGoalContract?.contract
          ? { goalContract: run.sourceGoalContract.contract }
          : {}),
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

  private async findSourceGoalRun(
    input: CreateSupervisorRunDraftInput,
    sourceGoalContract: NonNullable<
      CreateSupervisorRunDraftInput["sourceGoalContract"]
    >,
    sourceRunId: string
  ): Promise<SupervisorRunState | undefined> {
    const deterministic = await this.runs.get(sourceRunId, input.userId);
    if (deterministic) {
      return deterministic;
    }
    return (
      await this.runs.list({
        userId: input.userId,
        projectId: input.projectId,
        includeTerminal: true,
      })
    ).find(
      (candidate) =>
        candidate.sourceGoalContract?.intakeId === sourceGoalContract.intakeId
    );
  }

  private async pumpExistingSourceRun(
    run: SupervisorRunState
  ): Promise<SupervisorRunState> {
    if (this.workflowPump && !run.outcome && run.phase !== "finished") {
      return await this.workflowPump(run.runId, run.userId);
    }
    return run;
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
      if (draft.workflowPlan) {
        draft.workflowPlan.status = "approved";
        draft.workflowPlan.planVersion = input.planVersion;
      }
      initializeWorkflowTaskFacts(draft);
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
    const planning = await this.workflowRunBoundary.runExclusive(
      input.runId,
      async () => {
        const run = await this.requireRun(input.runId, input.userId);
        if (run.revision !== input.expectedRevision) {
          throw new Error(
            "Supervisor run revision changed before plan changes"
          );
        }
        if (run.status !== "awaiting_approval") {
          throw new Error(`Run ${run.runId} is not awaiting plan approval`);
        }
        const manager = run.managerSession;
        if (!(this.manager && manager)) {
          throw new Error(
            "ACP manager session is unavailable for plan changes"
          );
        }
        return await this.saveTransition(run, (draft) => {
          draft.status = "planning";
          resetWorkflowPlanningAuthority(draft);
          draft.audit.push({
            auditId: this.idFactory("audit"),
            kind: "plan_changes_requested",
            actor: "user",
            summary: input.requestedChanges,
            createdAt: this.now(),
          });
        });
      }
    );
    if (!this.workflowPump) {
      throw new Error("Durable workflow runtime is unavailable for replanning");
    }
    return await this.workflowPump(planning.runId, planning.userId);
  }

  async answerDecision(input: {
    runId: string;
    userId: string;
    decisionId: string;
    answer: string;
    criterionResolution?: "accept" | "waive";
    expectedRevision: number;
  }): Promise<SupervisorRunState> {
    const answered = await this.workflowRunBoundary.runExclusive(
      input.runId,
      async () => {
        const run = await this.requireRun(input.runId, input.userId);
        if (run.revision !== input.expectedRevision) {
          throw new Error(
            "Supervisor run revision changed before decision answer"
          );
        }
        const decision = run.decisions.find(
          (candidate) => candidate.decisionId === input.decisionId
        );
        if (!decision || decision.status !== "open") {
          throw new Error(`Manager decision is not open: ${input.decisionId}`);
        }
        const retryFinalDelivery = isFinalDeliveryRetry(
          run,
          decision.decisionId
        );
        const resolvesGoalCriteria =
          decision.kind === "goal_criteria_acceptance";
        const requiresCriterionReplan =
          decision.kind === "goal_criterion_evidence";
        if (resolvesGoalCriteria && !input.criterionResolution) {
          throw new Error(
            "Goal criterion decisions require an explicit accept or waive resolution"
          );
        }
        if (!resolvesGoalCriteria && input.criterionResolution) {
          throw new Error(
            "Criterion resolution is only valid for a Goal criterion acceptance decision"
          );
        }
        return await this.saveTransition(run, (draft) => {
          const target = draft.decisions.find(
            (candidate) => candidate.decisionId === input.decisionId
          );
          if (!target || target.status !== "open") {
            throw new Error(
              "Manager decision changed before answer persistence"
            );
          }
          target.status = "answered";
          target.answer = input.answer;
          target.answeredAt = this.now();
          target.answeredByUserId = input.userId;
          if (resolvesGoalCriteria) {
            recordGoalCriterionResolutions(
              draft,
              target,
              input.criterionResolution as "accept" | "waive",
              input.userId,
              target.answeredAt
            );
          }
          clearResolvedDecisionBlockers(draft, input.decisionId);
          draft.status =
            retryFinalDelivery || resolvesGoalCriteria
              ? "completing"
              : "planning";
          if (retryFinalDelivery || resolvesGoalCriteria) {
            rotateWorkflowAuthority(
              draft,
              retryFinalDelivery
                ? "final-delivery-retry"
                : "goal-criteria-resolved"
            );
          } else {
            resetWorkflowPlanningAuthority(draft);
            if (requiresCriterionReplan) {
              draft.phase = "planning";
              draft.activity = "planning";
            }
          }
          draft.audit.push({
            auditId: this.idFactory("audit"),
            kind: "decision_answered",
            actor: "user",
            summary: `Answered manager decision ${input.decisionId}`,
            createdAt: this.now(),
          });
        });
      }
    );
    if (!this.workflowPump) {
      return answered;
    }
    return await this.workflowPump(answered.runId, answered.userId);
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
    const paused = await this.workflowRunBoundary.runExclusive(
      runId,
      async () => {
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
    );
    if (this.workflowPump) {
      return await this.workflowPump(paused.runId, paused.userId);
    }
    return paused;
  }

  async resume(runId: string, userId: string): Promise<SupervisorRunState> {
    const resumed = await this.workflowRunBoundary.runExclusive(
      runId,
      async () => {
        const run = await this.requireRun(runId, userId);
        if (run.desiredState === "cancelled" && !run.outcome) {
          throw new Error(`Run ${runId} cancellation is still in progress`);
        }
        if (run.status !== "paused") {
          throw new Error(`Run ${runId} cannot be resumed from ${run.status}`);
        }
        return await this.saveTransition(run, (draft) => {
          draft.status = "queued";
          rotateWorkflowAuthority(draft, "resume");
          for (const task of draft.tasks) {
            if (task.dispatch) {
              task.dispatch = {
                dispatchId: `${task.taskId}-dispatch-${draft.revision + 1}`,
                state: task.capacityLease ? "leased" : "capacity_requested",
              };
            }
          }
        });
      }
    );
    return await this.scheduleFair(resumed);
  }

  async cancel(runId: string, userId: string): Promise<SupervisorRunState> {
    const cancelling = await this.workflowRunBoundary.runExclusive(
      runId,
      async () => {
        const run = await this.requireRun(runId, userId);
        if (run.outcome === "cancelled") {
          return run;
        }
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          throw new Error(
            `Run ${runId} cannot be cancelled from ${run.status}`
          );
        }
        if (run.desiredState === "cancelled" && run.cancellation) {
          if (run.cancellation.status !== "failed") {
            return run;
          }
          return await this.saveTransition(run, (draft) => {
            const failedDecisionId = draft.cancellation?.blockingDecisionId;
            if (!(failedDecisionId && draft.cancellation)) {
              throw new Error(
                `Run ${runId} has invalid failed cancellation state`
              );
            }
            const failedDecision = draft.decisions.find(
              (decision) => decision.decisionId === failedDecisionId
            );
            if (failedDecision?.status === "open") {
              failedDecision.status = "cancelled";
            }
            clearResolvedDecisionBlockers(draft, failedDecisionId);
            rotateWorkflowAuthority(draft, "cancel-retry");
          });
        }
        return await this.saveTransition(run, (draft) => {
          draft.desiredState = "cancelled";
          rotateWorkflowAuthority(draft, "cancel");
          draft.cancellation = {
            status: "pending",
            pendingSessionIds: [
              ...(draft.managerSession?.chatId
                ? [draft.managerSession.chatId]
                : []),
              ...draft.tasks.flatMap((task) =>
                task.attempts
                  .filter((attempt) =>
                    isActiveSupervisorAttemptStatus(attempt.status)
                  )
                  .map((attempt) => attempt.chatId)
              ),
            ],
            pendingWorkspaceIds: draft.tasks.flatMap((task) =>
              task.attempts.flatMap((attempt) =>
                attempt.workspace ? [attempt.workspace.workspaceId] : []
              )
            ),
          };
        });
      }
    );
    if (!this.workflowPump) {
      return cancelling;
    }
    return await this.workflowPump(cancelling.runId, cancelling.userId);
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
    const selected = await this.workflowRunBoundary.runExclusive(
      runId,
      async () => {
        const run = await this.requireRun(runId, userId);
        assertRunCanReplan(run);
        if (this.manager && run.managerSession) {
          const planning = await this.saveTransition(run, (draft) => {
            draft.status = "planning";
            resetWorkflowPlanningAuthority(draft);
          });
          return { kind: "managed" as const, run: planning };
        }
        return { kind: "legacy" as const, run };
      }
    );
    if (selected.kind === "managed") {
      if (!this.workflowPump) {
        throw new Error(
          "Durable workflow runtime is unavailable for replanning"
        );
      }
      return await this.workflowPump(selected.run.runId, selected.run.userId);
    }
    const run = selected.run;
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
        ...(run.sourceGoalContract?.contract
          ? { goalContract: run.sourceGoalContract.contract }
          : {}),
        completedTaskSummaries,
      },
      run.tasks
    );
    const proposed = await this.workflowRunBoundary.runExclusive(
      runId,
      async () => {
        const current = await this.requireRun(runId, userId);
        if (current.revision !== run.revision) {
          throw new Error("Supervisor run changed before replan persistence");
        }
        assertRunCanReplan(current);
        return await this.persistProposedPlan(
          current,
          {
            schemaVersion: 1,
            kind: "replan",
            summary: plan.proposal.summary,
            risks: [],
            tasks: plan.proposal.tasks,
            envelope: buildLegacyEnvelope(current, plan.tasks),
          },
          plan.tasks,
          { deferSchedule: true }
        );
      }
    );
    return proposed.status === "queued"
      ? await this.scheduleFair(proposed)
      : proposed;
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
    const workspaceId = attempt.workspace.workspaceId;
    const decided = await this.saveTransition(run, (draft) => {
      const draftGate = requirePendingGate(draft, input.gateId);
      draftGate.status = "approved";
      draftGate.decidedAt = this.now();
      draftGate.decidedByUserId = input.userId;
      const draftTask = requireTask(draft, gate.taskId);
      const previousBlocker = draftTask.integration?.blockingDecisionId;
      draftTask.integration = {
        integrationId:
          draftTask.integration?.integrationId ??
          `${gate.attemptId}-integration`,
        status: "pending",
        workspaceId,
      };
      draftTask.activity = "integration";
      if (draftTask.blockingDecisionId === previousBlocker) {
        Reflect.deleteProperty(draftTask, "blockingDecisionId");
      }
      if (draft.blockingDecisionId === previousBlocker) {
        Reflect.deleteProperty(draft, "blockingDecisionId");
      }
    });
    if (!this.workflowPump) {
      return decided;
    }
    return await this.workflowPump(decided.runId, decided.userId);
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

  async schedule(
    runId: string,
    userId: string,
    _maxDispatches?: number
  ): Promise<SupervisorRunState> {
    const run = await this.requireRun(runId, userId);
    if (!this.workflowPump) {
      return run;
    }
    return await this.workflowPump(runId, userId);
  }

  async executeWorkflowPlanEffect(input: {
    runId: string;
    userId: string;
    preparedPrompt: PreparedSupervisorPrompt;
  }): Promise<SupervisorRunState> {
    if (!this.manager) {
      throw new Error("ACP manager session is unavailable");
    }
    const run = await this.requireRun(input.runId, input.userId);
    const agents = filterEligibleAgents(
      await this.agents.listEligible({
        userId: run.userId,
        ...(run.projectId ? { projectId: run.projectId } : {}),
      }),
      run.agentAllowlist
    );
    const managerAgent =
      agents.find(
        (agent) =>
          agent.managerEligible &&
          (!run.legacyAutomation?.scheduleId ||
            agent.overnightEligible === true)
      ) ??
      (agents.every((agent) => agent.managerEligible === undefined)
        ? agents[0]
        : undefined);
    if (!managerAgent) {
      throw new Error("No configured manager agent is available");
    }
    return await this.manager.dispatch({
      runId: run.runId,
      userId: run.userId,
      managerAgentId: managerAgent.agentId,
      turnKind: run.plan ? "replan" : "plan",
      preparedPrompt: input.preparedPrompt,
      ...(latestPlanChangeRequest(run)
        ? { requestedChanges: latestPlanChangeRequest(run) }
        : {}),
    });
  }

  async executeWorkflowCapacityEffect(input: {
    runId: string;
    userId: string;
    taskId: string;
    effectId: string;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    const agentId = task.preferredAgentId;
    if (!agentId) {
      throw new Error(`Task ${task.taskId} has no selected agent`);
    }
    const capacity = await this.agentCapacity?.admit({
      userId: run.userId,
      ...(run.projectId ? { projectId: run.projectId } : {}),
      agentId,
      overnight: Boolean(run.legacyAutomation?.scheduleId),
    });
    if (capacity && !capacity.eligible) {
      const retryAt = new Date(Date.parse(this.now()) + 60_000).toISOString();
      return await this.saveTransition(run, (draft) => {
        const draftTask = requireTask(draft, input.taskId);
        draftTask.dispatch = {
          dispatchId:
            draftTask.dispatch?.dispatchId ?? `${input.effectId}-dispatch`,
          state: "capacity_requested",
          effectId: input.effectId,
          retryAt,
        };
        draftTask.activity = "capacity_wait";
        draftTask.notBefore = retryAt;
      });
    }
    const scheduleId = run.legacyAutomation?.scheduleId;
    const providerId = run.legacyAutomation?.providerId;
    if (scheduleId && providerId && this.dispatchAdmission) {
      const admission = await this.dispatchAdmission.admit({
        userId: run.userId,
        runId: run.runId,
        scheduleId,
        providerId,
        taskId: task.taskId,
      });
      if (!admission.eligible) {
        return run;
      }
    }
    const now = this.now();
    return await this.saveTransition(run, (draft) => {
      const draftTask = requireTask(draft, input.taskId);
      const dispatchId =
        draftTask.dispatch?.dispatchId ?? `${input.effectId}-dispatch`;
      draftTask.dispatch = {
        dispatchId,
        state: "leased",
        effectId: input.effectId,
      };
      draftTask.capacityLease = {
        leaseId: `${input.effectId}-lease`,
        agentIdentityId: agentId,
        issuedAt: now,
        expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      };
      draftTask.activity = "dispatching";
      Reflect.deleteProperty(draftTask, "notBefore");
    });
  }

  async executeWorkflowStartTurnEffect(input: {
    runId: string;
    userId: string;
    taskId: string;
    preparedPrompt: PreparedSupervisorPrompt;
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    if (task.dispatch?.state !== "start_requested" || !task.capacityLease) {
      throw new Error(`Task ${task.taskId} has no durable dispatch lease`);
    }
    let workspace: PreparedWorkerWorkspace | undefined;
    try {
      workspace = await this.workspaces.prepare({
        runId: run.runId,
        taskId: task.taskId,
        attemptKey: input.preparedPrompt.effectId,
        projectRoot: run.projectRoot,
        executionMode: task.executionMode,
        filesAllowed: task.filesAllowed,
        baseSnapshot: run.baseSnapshot,
      });
    } catch (error) {
      if (isDirectWorkspaceBusy(error)) {
        return run;
      }
      const blocked = await this.saveTransition(run, (draft) => {
        draft.status = "needs_user";
        requireTask(draft, input.taskId).status = "needs_user";
      });
      throw new SupervisorWorkspacePreparationError(blocked, error);
    }
    await this.workers.dispatch({
      runId: run.runId,
      userId: run.userId,
      taskId: task.taskId,
      idempotencyKey: input.preparedPrompt.effectId,
      preparedPrompt: input.preparedPrompt,
      workspace,
    });
    return await this.requireRun(run.runId, run.userId);
  }

  async recordWorkerResult(input: {
    runId: string;
    userId: string;
    taskId: string;
    attemptId: string;
    result: unknown;
    destructiveActions?: string[];
  }): Promise<SupervisorRunState> {
    const run = await this.requireRun(input.runId, input.userId);
    const task = requireTask(run, input.taskId);
    const attempt = requireAttempt(task, input.attemptId);
    if (attempt.result) {
      return run;
    }
    const result = SupervisorWorkerResultSchema.parse(input.result);
    const assessment = this.results.assess({ task, attempt, result });
    const reviewDecisionId = `${input.attemptId}-result-review`;
    const recorded = await this.saveTransition(run, (draft) => {
      const draftTask = requireTask(draft, input.taskId);
      const draftAttempt = requireAttempt(draftTask, input.attemptId);
      draftAttempt.status = "terminal";
      draftAttempt.finishedAt = result.finishedAt;
      draftAttempt.result = result;
      Reflect.deleteProperty(draftTask, "activeAttemptId");
      Reflect.deleteProperty(draftTask, "dispatch");
      Reflect.deleteProperty(draftTask, "capacityLease");
      if (assessment.decision === "accept") {
        draftTask.activity = "verification";
        draftTask.verification = {
          verificationId: `${input.attemptId}-verification`,
          status: "not_started",
          evidenceRefs: [],
        };
        draftTask.acceptance = "pending";
      } else {
        draftTask.blockingDecisionId =
          draftTask.blockingDecisionId ?? reviewDecisionId;
        if (
          !draft.decisions.some(
            (decision) => decision.decisionId === reviewDecisionId
          )
        ) {
          draft.decisions.push({
            decisionId: reviewDecisionId,
            kind: "classifier_uncertain",
            status: "open",
            prompt: result.reason,
            createdAt: this.now(),
          });
        }
        Reflect.deleteProperty(draftTask, "activity");
      }
    });
    if (!this.workflowPump) {
      return recorded;
    }
    return await this.workflowPump(recorded.runId, recorded.userId);
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
      result = createTerminalSuccessResult({
        attempt,
        reason: input.reason,
        resultText: input.resultText,
        now: this.now(),
      });
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
    prevalidatedLegacyTasks?: SupervisorTaskRecord[],
    options: { deferSchedule?: boolean } = {}
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
          ...(run.sourceGoalContract?.contract
            ? { goalContract: run.sourceGoalContract.contract }
            : {}),
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
    const normalizedEnvelope = {
      ...turn.envelope,
      fileScopes: turn.envelope.fileScopes.map(normalizeSafeRelativePath),
    };
    assertManagerEnvelope(run, normalizedEnvelope, validatedTasks);
    const version = (run.plan?.version ?? 0) + 1;
    const hash = computeSupervisorPlanHash({
      version,
      summary: turn.summary,
      envelope: normalizedEnvelope,
      tasks: validatedTasks,
    });
    const autoApproved = Boolean(
      turn.kind === "replan" &&
        run.plan?.approvedAt &&
        isReplanInsideApprovedEnvelope({
          approved: run.plan.envelope,
          proposed: normalizedEnvelope,
        }) &&
        authorityDeclarationsRemainApproved(run, validatedTasks)
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
        envelope: normalizedEnvelope,
        ...(autoApproved && run.plan?.approvedAt && run.plan.approvedByUserId
          ? {
              approvedAt: run.plan.approvedAt,
              approvedByUserId: run.plan.approvedByUserId,
            }
          : {}),
      };
      draft.workflowPlan = {
        goalRevisionId:
          draft.workflowPlan?.goalRevisionId ??
          `${draft.runId}-goal-${version}`,
        authorityId:
          draft.workflowPlan?.authorityId ??
          `${draft.runId}-authority-${version}`,
        status: autoApproved ? "approved" : "proposed",
        planVersion: version,
      };
      initializeWorkflowTaskFacts(draft);
      draft.status = autoApproved ? "queued" : "awaiting_approval";
      draft.audit.push({
        auditId: this.idFactory("audit"),
        kind: autoApproved ? "plan_accepted" : "plan_awaiting_approval",
        actor: "orchestrator",
        summary: `${autoApproved ? "Auto-approved" : "Proposed"} plan v${version} ${hash.slice(0, 12)}`,
        createdAt: this.now(),
      });
    });
    return autoApproved && !options.deferSchedule
      ? await this.scheduleFair(proposed)
      : proposed;
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

function isDirectWorkspaceBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "DIRECT_WORKSPACE_BUSY"
  );
}

function resetWorkflowPlanningAuthority(run: SupervisorRunState): void {
  const generation = (run.plan?.version ?? 0) + 1;
  run.workflowPlan = {
    goalRevisionId: `${run.runId}-goal-${generation}-${run.revision + 1}`,
    authorityId: `${run.runId}-authority-${generation}-${run.revision + 1}`,
    status: "missing",
  };
}

function rotateWorkflowAuthority(
  run: SupervisorRunState,
  reason:
    | "cancel"
    | "cancel-retry"
    | "resume"
    | "final-delivery-retry"
    | "goal-criteria-resolved"
): void {
  const generation = run.revision + 1;
  const previous = run.workflowPlan;
  run.workflowPlan = {
    goalRevisionId:
      previous?.goalRevisionId ?? `${run.runId}-goal-${generation}`,
    authorityId: `${run.runId}-${reason}-authority-${generation}`,
    status: previous?.status ?? "missing",
    ...(previous?.planVersion ? { planVersion: previous.planVersion } : {}),
    ...(previous?.blockingDecisionId
      ? { blockingDecisionId: previous.blockingDecisionId }
      : {}),
  };
}

function initializeWorkflowTaskFacts(run: SupervisorRunState): void {
  for (const task of run.tasks) {
    task.acceptance ??= "pending";
    task.integration ??= {
      integrationId: `${run.runId}-${task.taskId}-integration`,
      status: "not_required",
    };
    task.verification ??= {
      verificationId: `${run.runId}-${task.taskId}-verification`,
      status: "not_started",
      evidenceRefs: [],
    };
  }
}

function latestPlanChangeRequest(run: SupervisorRunState): string | undefined {
  return [...run.audit]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "plan_changes_requested" ||
        entry.kind === "decision_answered"
    )?.summary;
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

function collectActiveAttempts(run: SupervisorRunState) {
  return run.tasks.flatMap((task) =>
    task.attempts
      .filter((attempt) => isActiveSupervisorAttemptStatus(attempt.status))
      .map((attempt) => ({
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        workspace: attempt.workspace,
      }))
  );
}

function assertRunCanReplan(run: SupervisorRunState): void {
  if (TERMINAL_RUN_STATUSES.has(run.status) || run.status === "completing") {
    throw new Error(`Run ${run.runId} cannot be replanned from ${run.status}`);
  }
  if (collectActiveAttempts(run).length > 0) {
    throw new Error("Active workers must finish or be cancelled before replan");
  }
  if (run.plannerReplanCount >= run.limits.maxPlannerReplans) {
    throw new Error(`Run ${run.runId} exhausted its replan budget`);
  }
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

function recordGoalCriterionResolutions(
  run: SupervisorRunState,
  decision: SupervisorRunState["decisions"][number],
  resolution: "accept" | "waive",
  userId: string,
  resolvedAt: string
): void {
  const contract = run.sourceGoalContract?.contract;
  if (!(contract && decision.criterionIds)) {
    throw new Error(
      "Goal criterion decision is missing its frozen contract binding"
    );
  }
  const pendingUserCriterionIds = new Set(
    assessGoalContractCriteria(run).pendingUserCriterionIds
  );
  const userCriteria = new Set(
    contract.acceptanceCriteria
      .filter((criterion) => criterion.evidence === "user")
      .map((criterion) => criterion.criterionId)
  );
  for (const criterionId of decision.criterionIds) {
    if (
      !(
        userCriteria.has(criterionId) &&
        pendingUserCriterionIds.has(criterionId)
      )
    ) {
      throw new Error(
        `Goal criterion ${criterionId} is not pending explicit user resolution`
      );
    }
  }
  for (const criterionId of decision.criterionIds) {
    run.goalCriterionResolutions.push({
      criterionId,
      resolution: resolution === "accept" ? "user_accepted" : "waived",
      decisionId: decision.decisionId,
      resolvedAt,
      resolvedByUserId: userId,
    });
  }
}

function clearResolvedDecisionBlockers(
  run: SupervisorRunState,
  decisionId: string
): void {
  if (run.blockingDecisionId === decisionId) {
    Reflect.deleteProperty(run, "blockingDecisionId");
  }
  if (run.workflowPlan?.blockingDecisionId === decisionId) {
    run.workflowPlan.status = "requested";
    Reflect.deleteProperty(run.workflowPlan, "blockingDecisionId");
  }
  if (run.workflowFinalVerification?.blockingDecisionId === decisionId) {
    run.workflowFinalVerification.status = "not_started";
    Reflect.deleteProperty(run.workflowFinalVerification, "blockingDecisionId");
  }
  if (run.finalization?.blockingDecisionId === decisionId) {
    run.finalization.status = "pending";
    Reflect.deleteProperty(run.finalization, "blockingDecisionId");
  }
  if (run.cancellation?.blockingDecisionId === decisionId) {
    run.cancellation.status = "pending";
    Reflect.deleteProperty(run.cancellation, "blockingDecisionId");
  }
  for (const task of run.tasks) {
    if (task.blockingDecisionId === decisionId) {
      Reflect.deleteProperty(task, "blockingDecisionId");
    }
    if (task.verification?.blockingDecisionId === decisionId) {
      task.verification.status = "not_started";
      Reflect.deleteProperty(task.verification, "blockingDecisionId");
    }
    if (task.integration?.blockingDecisionId === decisionId) {
      task.integration.status = "pending";
      Reflect.deleteProperty(task.integration, "blockingDecisionId");
    }
  }
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

function createTerminalSuccessResult(input: {
  attempt: SupervisorWorkerAttempt;
  reason: string;
  resultText: string;
  now: string;
}) {
  const outcomeSummary = input.resultText.trim().slice(0, 8000);
  return SupervisorWorkerResultSchema.parse({
    semanticStatus: "succeeded",
    reason: input.reason.trim().slice(0, 4000) || "ACP worker completed",
    outcomeSummary: outcomeSummary || "ACP worker completed the assigned task",
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
  });
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

function createSourceGoalRunId(userId: string, intakeId: string): string {
  const digest = CryptoHasher.hash("sha256", `${userId}\0${intakeId}`, "hex");
  return `supervisor-run-goal-${digest}`;
}

function requireExactSourceGoalBinding(
  run: SupervisorRunState,
  input: CreateSupervisorRunDraftInput,
  sourceGoalContract: NonNullable<
    CreateSupervisorRunDraftInput["sourceGoalContract"]
  >
): SupervisorRunState {
  const source = run.sourceGoalContract;
  if (
    run.projectId !== input.projectId ||
    source?.intakeId !== sourceGoalContract.intakeId ||
    source.revisionId !== sourceGoalContract.revisionId ||
    source.hash !== sourceGoalContract.hash
  ) {
    throw new Error(
      `Goal intake ${sourceGoalContract.intakeId} is already bound to another contract revision`
    );
  }
  return run;
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

function authorityDeclarationsRemainApproved(
  run: SupervisorRunState,
  proposedTasks: SupervisorTaskRecord[]
): boolean {
  const authority = run.sourceGoalContract?.contract?.authority;
  if (!authority) {
    return true;
  }
  const askKinds = new Set<SupervisorTaskRecord["changeKinds"][number]>();
  if (authority.scopedCodeChange === "ask") {
    askKinds.add("scoped_code_change");
  }
  if (authority.architectureChange === "ask") {
    askKinds.add("architecture_change");
  }
  if (authority.dependencyChange === "ask") {
    askKinds.add("dependency_change");
  }
  if (authority.finalIntegration === "ask") {
    askKinds.add("final_integration");
  }
  const approvedByTaskId = new Map(
    run.tasks.map((task) => [task.taskId, new Set(task.changeKinds)])
  );
  return proposedTasks.every((task) => {
    const previouslyApproved = approvedByTaskId.get(task.taskId);
    return task.changeKinds.every(
      (kind) => !askKinds.has(kind) || previouslyApproved?.has(kind) === true
    );
  });
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
