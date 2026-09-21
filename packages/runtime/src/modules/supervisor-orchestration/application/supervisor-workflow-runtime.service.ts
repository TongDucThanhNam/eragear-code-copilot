import { CryptoHasher } from "bun";
import { z } from "zod";
import {
  type CommitWorkflowEffectHandlerResultInput,
  computeWorkflowPayloadHash,
  EffectExecutor,
  KNOWN_WORKFLOW_EFFECT_TYPES,
  RunReconciler,
  type RunReconcilerDecision,
  type RunReconcilerSnapshot,
  type SupervisorWorkflowUnitOfWorkPort,
  type WorkflowEffectHandlerResult,
  type WorkflowEffectIntent,
  type WorkflowEffectIntentInput,
  type WorkflowEffectRecord,
  type WorkflowJournalPort,
  type WorkflowJsonValue,
} from "#runtime/modules/workflow";
import {
  assessGoalContractCriteria,
  goalContractCriteriaAreSatisfied,
  type SupervisorFileManifest,
  SupervisorFileManifestSchema,
  type SupervisorPatchArtifact,
  SupervisorPatchArtifactSchema,
  type SupervisorRunState,
  type SupervisorTaskRecord,
  type SupervisorVerificationEvidence,
  SupervisorVerificationEvidenceSchema,
  type SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";
import {
  SupervisorRunRevisionConflictError,
  transitionSupervisorRun,
} from "../domain/supervisor-run.transitions";
import { buildAcpManagerPrompt } from "./acp-manager-prompt.builder";
import {
  computeSupervisorPromptHash,
  type PreparedSupervisorPrompt,
} from "./ports/supervisor-effect-prompt-dispatch.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  SupervisorWorkflowRunBoundary,
  type SupervisorWorkflowRunBoundaryPort,
} from "./supervisor-workflow-run-boundary";
import {
  buildWorkerPrompt,
  buildWorkerResumePrompt,
} from "./worker-prompt.builder";

const DEFAULT_MAX_RECONCILE_PASSES = 4;
const DEFAULT_MAX_EFFECTS_PER_PASS = 32;
const MAX_CAS_ATTEMPTS = 8;
const DEFAULT_CAPACITY_LEASE_MS = 60_000;

type OperationalEffectType =
  | "stop_agent_session"
  | "dispose_workspace"
  | "create_final_commit"
  | "resume_manager_session";

type OperationalEffectIntent =
  | {
      type: "stop_agent_session";
      purpose: "cancellation";
      runId: string;
      sessionId: string;
      dedupeKey: string;
    }
  | {
      type: "stop_agent_session";
      purpose: "capacity_suspension";
      runId: string;
      sessionId: string;
      waitId: string;
      parentAuthorityId: string;
      workItemId?: string;
      attemptId?: string;
      dedupeKey: string;
    }
  | {
      type: "dispose_workspace";
      runId: string;
      workspaceId: string;
      dedupeKey: string;
    }
  | {
      type: "create_final_commit";
      runId: string;
      dedupeKey: string;
    }
  | {
      type: "resume_manager_session";
      runId: string;
      waitId: string;
      retryAt: string;
      dedupeKey: string;
    };

export interface SupervisorWorkflowEffectContext {
  effect: WorkflowEffectRecord;
  run: SupervisorRunState;
  userId: string;
  intent: Record<string, WorkflowJsonValue>;
  preparedPrompt?: PreparedSupervisorPrompt;
}

export type SupervisorWorkflowStateResult =
  | { kind: "wakeup_observed" }
  | { kind: "plan_requested" }
  | { kind: "manager_session_resumed"; waitId: string }
  | {
      kind: "capacity_observed";
      taskId: string;
      available: boolean;
      agentIdentityId: string;
      retryAt?: string;
    }
  | { kind: "turn_started"; taskId: string; attemptId: string }
  | { kind: "session_resumed"; taskId: string; attemptId: string }
  | {
      kind: "uncertain_turn_inspected";
      taskId: string;
      attemptId: string;
      disposition: "running" | "waiting_capacity" | "needs_user";
      retryAt?: string;
      decisionId?: string;
    }
  | {
      kind: "verification_completed";
      scope: "run" | "work_item";
      taskId?: string;
      passed: boolean;
      evidenceRefs: string[];
      evidence: SupervisorVerificationEvidence[];
      decisionId?: string;
      reason?: string;
    }
  | { kind: "decision_requested"; decisionId: string; taskId?: string }
  | {
      kind: "integration_completed";
      taskId: string;
      passed: boolean;
      decisionId?: string;
      reason?: string;
      files?: SupervisorFileManifest;
      patch?: SupervisorPatchArtifact;
      deliveryFingerprints?: Record<string, string>;
    }
  | { kind: "agent_session_stopped"; sessionId: string }
  | { kind: "workspace_disposed"; workspaceId: string }
  | { kind: "final_commit_created"; commitSha: string; safetyRef?: string };

const StateResultIdSchema = z.string().trim().min(1).max(200);
const SupervisorWorkflowStateResultSchema: z.ZodType<SupervisorWorkflowStateResult> =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("wakeup_observed") }).strict(),
    z.object({ kind: z.literal("plan_requested") }).strict(),
    z
      .object({
        kind: z.literal("manager_session_resumed"),
        waitId: StateResultIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("capacity_observed"),
        taskId: StateResultIdSchema,
        available: z.boolean(),
        agentIdentityId: StateResultIdSchema,
        retryAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("turn_started"),
        taskId: StateResultIdSchema,
        attemptId: StateResultIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("session_resumed"),
        taskId: StateResultIdSchema,
        attemptId: StateResultIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("uncertain_turn_inspected"),
        taskId: StateResultIdSchema,
        attemptId: StateResultIdSchema,
        disposition: z.enum(["running", "waiting_capacity", "needs_user"]),
        retryAt: z.string().datetime({ offset: true }).optional(),
        decisionId: StateResultIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("verification_completed"),
        scope: z.enum(["run", "work_item"]),
        taskId: StateResultIdSchema.optional(),
        passed: z.boolean(),
        evidenceRefs: z.array(StateResultIdSchema).max(4096),
        evidence: z.array(SupervisorVerificationEvidenceSchema).max(128),
        decisionId: StateResultIdSchema.optional(),
        reason: z.string().trim().min(1).max(8000).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("decision_requested"),
        decisionId: StateResultIdSchema,
        taskId: StateResultIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("integration_completed"),
        taskId: StateResultIdSchema,
        passed: z.boolean(),
        decisionId: StateResultIdSchema.optional(),
        reason: z.string().trim().min(1).max(8000).optional(),
        files: SupervisorFileManifestSchema.optional(),
        patch: SupervisorPatchArtifactSchema.optional(),
        deliveryFingerprints: z
          .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
          .optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("agent_session_stopped"),
        sessionId: StateResultIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("workspace_disposed"),
        workspaceId: StateResultIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("final_commit_created"),
        commitSha: z.string().trim().min(1).max(1024),
        safetyRef: z.string().trim().min(1).max(2048).optional(),
      })
      .strict(),
  ]);

export interface SupervisorWorkflowEffectFacade {
  requestPlan(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  requestCapacity(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  startTurn(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  resumeSession(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  resumeManagerSession(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  inspectUncertainTurn(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  runVerification(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  requestDecision(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  integrateWorkspace(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  stopAgentSession(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  disposeWorkspace(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
  createFinalCommit(
    input: SupervisorWorkflowEffectContext
  ): Promise<SupervisorWorkflowStateResult>;
}

export interface SupervisorWorkflowRuntimeTickResult {
  reconciledRuns: number;
  materializedEffects: number;
  claimedEffects: number;
  succeededEffects: number;
  failedEffects: number;
  uncertainEffects: number;
}

export interface SupervisorWorkflowStartupInput {
  releasedEffects: WorkflowEffectRecord[];
  uncertainEffects: WorkflowEffectRecord[];
}

export interface SupervisorWorkflowRuntimeDeps {
  runs: SupervisorRunRepositoryPort;
  journal: WorkflowJournalPort;
  unitOfWork: SupervisorWorkflowUnitOfWorkPort;
  effects: SupervisorWorkflowEffectFacade;
  runBoundary?: SupervisorWorkflowRunBoundaryPort;
  trustedVerificationCommands?: string[];
  now?: () => string;
  maxReconcilePasses?: number;
  maxEffectsPerPass?: number;
  onRunCommitted?: (run: SupervisorRunState) => void | Promise<void>;
}

interface PersistedEffectPayload {
  userId: string;
  intent: Record<string, WorkflowJsonValue>;
  preparedPrompt?: PreparedSupervisorPrompt;
}

interface ReconcileRunResult {
  reconciled: boolean;
  materializedEffects: number;
}

/**
 * Active durable execution seam for Supervisor runs.
 *
 * The reconciler is pure. This service atomically materializes its proposals,
 * then lets EffectExecutor claim and start them before any handler I/O.
 */
export class SupervisorWorkflowRuntimeService {
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly journal: WorkflowJournalPort;
  private readonly unitOfWork: SupervisorWorkflowUnitOfWorkPort;
  private readonly effects: SupervisorWorkflowEffectFacade;
  private readonly runBoundary: SupervisorWorkflowRunBoundaryPort;
  private readonly reconciler = new RunReconciler();
  private readonly executor: EffectExecutor;
  private readonly trustedVerificationCommands: string[];
  private readonly now: () => string;
  private readonly maxReconcilePasses: number;
  private readonly maxEffectsPerPass: number;
  private readonly onRunCommitted?: SupervisorWorkflowRuntimeDeps["onRunCommitted"];
  private activeTick: Promise<SupervisorWorkflowRuntimeTickResult> | null =
    null;

  constructor(deps: SupervisorWorkflowRuntimeDeps) {
    this.runs = deps.runs;
    this.journal = deps.journal;
    this.unitOfWork = deps.unitOfWork;
    this.effects = deps.effects;
    this.runBoundary = deps.runBoundary ?? new SupervisorWorkflowRunBoundary();
    this.trustedVerificationCommands = [
      ...(deps.trustedVerificationCommands ?? []),
    ];
    this.now = deps.now ?? (() => new Date().toISOString());
    this.maxReconcilePasses = Math.max(
      1,
      deps.maxReconcilePasses ?? DEFAULT_MAX_RECONCILE_PASSES
    );
    this.maxEffectsPerPass = Math.max(
      1,
      deps.maxEffectsPerPass ?? DEFAULT_MAX_EFFECTS_PER_PASS
    );
    this.onRunCommitted = deps.onRunCommitted;
    this.executor = new EffectExecutor({
      journal: deps.journal,
      handlers: this.createHandlers(),
      commitHandlerResult: (input) => this.commitHandlerResult(input),
      executeClaimedEffect: ({ effect }, execute) =>
        this.runBoundary.runExclusive(effect.runId, execute),
      now: () => Date.parse(this.now()),
    });
  }

  tick(): Promise<SupervisorWorkflowRuntimeTickResult> {
    if (this.activeTick) {
      return this.activeTick;
    }
    const tick = this.runTick().finally(() => {
      if (this.activeTick === tick) {
        this.activeTick = null;
      }
    });
    this.activeTick = tick;
    return tick;
  }

  async pumpRun(input: {
    runId: string;
    userId: string;
  }): Promise<SupervisorRunState> {
    await this.reconcileRun(input.runId, input.userId);
    await this.executor.executeDueEffects({ limit: this.maxEffectsPerPass });
    await this.reconcileRun(input.runId, input.userId);
    const run = await this.runs.get(input.runId, input.userId);
    if (!run) {
      throw new Error(`Supervisor run not found: ${input.runId}`);
    }
    return run;
  }

  async recoverStartup(
    input: SupervisorWorkflowStartupInput
  ): Promise<SupervisorWorkflowRuntimeTickResult> {
    await this.projectUncertainAttempts(input.uncertainEffects);
    return await this.tick();
  }

  private async runTick(): Promise<SupervisorWorkflowRuntimeTickResult> {
    const summary: SupervisorWorkflowRuntimeTickResult = {
      reconciledRuns: 0,
      materializedEffects: 0,
      claimedEffects: 0,
      succeededEffects: 0,
      failedEffects: 0,
      uncertainEffects: 0,
    };
    const staleEffects = await this.journal.markStaleStartedDispatchesUncertain(
      {
        effectTypes: [...KNOWN_WORKFLOW_EFFECT_TYPES],
        nowMs: Date.parse(this.now()),
        error: {
          code: "WORKFLOW_EFFECT_LEASE_EXPIRED",
          message:
            "The effect started, but its durable execution lease expired before acknowledgement.",
        },
        includeUnexpired: false,
      }
    );
    if (staleEffects.length > 0) {
      await this.projectUncertainAttempts(staleEffects);
      summary.uncertainEffects += staleEffects.length;
    }
    for (let pass = 0; pass < this.maxReconcilePasses; pass += 1) {
      let materialized = 0;
      for (const run of await this.runs.listNonTerminal()) {
        const result = await this.reconcileRun(run.runId, run.userId);
        summary.reconciledRuns += result.reconciled ? 1 : 0;
        summary.materializedEffects += result.materializedEffects;
        materialized += result.materializedEffects;
      }
      const execution = await this.executor.executeDueEffects({
        limit: this.maxEffectsPerPass,
      });
      summary.claimedEffects += execution.claimedEffectIds.length;
      for (const effect of execution.effects) {
        if (effect.outcome === "succeeded") {
          summary.succeededEffects += 1;
        } else if (effect.outcome === "failed") {
          summary.failedEffects += 1;
        } else if (effect.outcome === "uncertain") {
          summary.uncertainEffects += 1;
        }
      }
      if (materialized === 0 && execution.claimedEffectIds.length === 0) {
        break;
      }
    }
    return summary;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Reconciliation keeps authority revocation, terminal transitions, and one CAS materialization loop together so their ordering is auditable.
  private async reconcileRun(
    runId: string,
    userId: string
  ): Promise<ReconcileRunResult> {
    for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
      const run = await this.runs.get(runId, userId);
      if (!run || run.outcome) {
        return { reconciled: false, materializedEffects: 0 };
      }
      let occupied = await this.journal.listEffects(run.runId);
      const allowedAuthorities = allowedEffectAuthorities(run);
      const authoritiesToRevoke = new Set(
        occupied
          .filter(
            (effect) =>
              effect.status === "pending" &&
              !allowedAuthorities.has(effect.authorityId)
          )
          .map((effect) => effect.authorityId)
      );
      for (const authorityId of authoritiesToRevoke) {
        await this.unitOfWork.cancelPendingEffects({
          runId: run.runId,
          authorityId,
          cancelledAtMs: Date.parse(this.now()),
          reason: {
            code: "WORKFLOW_AUTHORITY_REVOKED",
            desiredState: run.desiredState,
            currentAuthorityIds: [...allowedAuthorities],
          },
        });
      }
      if (authoritiesToRevoke.size > 0) {
        occupied = await this.journal.listEffects(run.runId);
      }
      const snapshot = createRunReconcilerSnapshot(run, occupied);
      const decision = this.reconciler.decide(snapshot, this.now());
      const runnableDecision = {
        ...decision,
        effects: decision.effects.filter((effect) =>
          isCapacityResumeAllowed(run, effect, occupied)
        ),
      };
      const operational = deriveOperationalEffects(
        run,
        runnableDecision,
        occupied
      );
      const intents = [...runnableDecision.effects, ...operational];

      if (
        run.desiredState === "cancelled" &&
        run.cancellation &&
        run.cancellation.status !== "failed" &&
        run.cancellation.pendingSessionIds.length === 0 &&
        run.cancellation.pendingWorkspaceIds.length === 0
      ) {
        const committed = await this.tryCommitStateOnly(
          run,
          (draft) => {
            draft.cancellation = {
              ...draft.cancellation,
              status: "succeeded",
              pendingSessionIds: [],
              pendingWorkspaceIds: [],
            };
            for (const task of draft.tasks) {
              for (const attempt of task.attempts) {
                if (isAttemptInFlight(attempt)) {
                  attempt.status = "interrupted";
                  attempt.finishedAt = this.now();
                  clearOptional(attempt, "uncertaintyId");
                }
              }
              clearOptional(task, "activeAttemptId");
              if (!task.outcome) {
                task.outcome = "cancelled";
              }
              clearOptional(task, "activity");
            }
            draft.phase = "finished";
            draft.outcome = "cancelled";
            clearOptional(draft, "activity");
          },
          "workflow_cancellation_completed"
        );
        if (committed) {
          return { reconciled: true, materializedEffects: 0 };
        }
        continue;
      }

      if (
        decision.readyForFinalization &&
        run.phase === "executing" &&
        run.desiredState === "running"
      ) {
        const criterionDecision = goalCriterionDecision(run);
        if (criterionDecision) {
          const existing = run.decisions.find(
            (candidate) =>
              candidate.decisionId === criterionDecision.decisionId &&
              candidate.status === "open"
          );
          if (
            existing &&
            run.blockingDecisionId === criterionDecision.decisionId
          ) {
            return { reconciled: true, materializedEffects: 0 };
          }
          const committed = await this.tryCommitStateOnly(
            run,
            (draft) => {
              if (
                !draft.decisions.some(
                  (candidate) =>
                    candidate.decisionId === criterionDecision.decisionId
                )
              ) {
                draft.decisions.push(criterionDecision);
              }
              draft.blockingDecisionId = criterionDecision.decisionId;
            },
            "goal_contract_criterion_decision_opened"
          );
          if (committed) {
            return { reconciled: true, materializedEffects: 0 };
          }
          continue;
        }
        const committed = await this.tryCommitStateOnly(
          run,
          (draft) => {
            const finalVerificationCommands = resolveRunVerificationCommands(
              draft,
              this.trustedVerificationCommands
            );
            draft.phase = "finalizing";
            draft.activity = "finalizing";
            draft.workflowFinalVerification ??= {
              verificationId: stableId(
                "run-verification",
                draft.runId,
                String(draft.plan?.version ?? 1)
              ),
              status:
                finalVerificationCommands.length === 0
                  ? "not_required"
                  : "not_started",
              evidenceRefs: [],
            };
            draft.finalization ??= { status: "pending" };
          },
          "workflow_finalization_started"
        );
        if (committed) {
          return { reconciled: true, materializedEffects: 0 };
        }
        continue;
      }

      if (intents.length === 0) {
        return { reconciled: true, materializedEffects: 0 };
      }

      const materialized = intents.map((intent) =>
        materializeEffect({
          run,
          authorityId: resolveIntentAuthority(run, intent),
          intent,
          trustedVerificationCommands: this.trustedVerificationCommands,
          now: this.now(),
        })
      );
      const next = transitionSupervisorRun(run, {
        expectedRevision: run.revision,
        now: this.now(),
        mutate: (draft) => {
          for (let index = 0; index < intents.length; index += 1) {
            markEffectMaterialized(draft, intents[index], materialized[index]);
          }
        },
      });
      try {
        const committed = await this.unitOfWork.commitRunTransition({
          expectedRevision: run.revision,
          snapshot: next,
          event: createWorkflowEvent(next, "workflow_effects_materialized", {
            effectIds: materialized.map((effect) => effect.effectId),
          }),
          effects: materialized,
        });
        await this.onRunCommitted?.(committed.snapshot);
        return {
          reconciled: true,
          materializedEffects: committed.effects.length,
        };
      } catch (error) {
        if (!isRevisionConflict(error)) {
          throw error;
        }
      }
    }
    throw new Error(`Workflow reconciliation CAS budget exhausted: ${runId}`);
  }

  private createHandlers() {
    return {
      request_plan: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.requestPlan(context)
        ),
      request_capacity: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.requestCapacity(context)
        ),
      start_turn: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.startTurn(context)
        ),
      resume_session: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.resumeSession(context)
        ),
      resume_manager_session: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.resumeManagerSession(context)
        ),
      inspect_uncertain_turn: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.inspectUncertainTurn(context)
        ),
      run_verification: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.runVerification(context)
        ),
      request_decision: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.requestDecision(context)
        ),
      schedule_wakeup: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, () =>
          Promise.resolve({
            kind: "wakeup_observed",
          })
        ),
      integrate_workspace: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.integrateWorkspace(context)
        ),
      stop_agent_session: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.stopAgentSession(context)
        ),
      dispose_workspace: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.disposeWorkspace(context)
        ),
      create_final_commit: (input: { effect: WorkflowEffectRecord }) =>
        this.invokeFacade(input.effect, (context) =>
          this.effects.createFinalCommit(context)
        ),
    };
  }

  private async invokeFacade(
    effect: WorkflowEffectRecord,
    execute: (
      context: SupervisorWorkflowEffectContext
    ) => Promise<SupervisorWorkflowStateResult>
  ): Promise<WorkflowEffectHandlerResult> {
    const payload = parsePersistedEffectPayload(effect.payload);
    const run = await this.runs.get(effect.runId, payload.userId);
    if (!run) {
      return failedAuthorityResult("WORKFLOW_RUN_NOT_FOUND", effect);
    }
    const authorityFailure = workflowEffectAuthorityFailure(run, effect);
    if (authorityFailure) {
      return failedAuthorityResult(authorityFailure, effect);
    }
    assertEffectStillApplicable(run, effect, payload.intent);
    const result = await execute({
      effect,
      run,
      userId: payload.userId,
      intent: payload.intent,
      ...(payload.preparedPrompt
        ? { preparedPrompt: payload.preparedPrompt }
        : {}),
    });
    return {
      outcome: "succeeded",
      result: jsonObject(result) as WorkflowJsonValue,
    };
  }

  private async commitHandlerResult(
    input: CommitWorkflowEffectHandlerResultInput
  ): Promise<WorkflowEffectRecord | null> {
    for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
      const payload = parsePersistedEffectPayload(input.effect.payload);
      const current = await this.runs.get(input.effect.runId, payload.userId);
      if (!current) {
        return null;
      }
      const authorityFailure = workflowEffectAuthorityFailure(
        current,
        input.effect
      );
      const result = authorityFailure
        ? failedAuthorityResult(authorityFailure, input.effect)
        : input.result;
      const now = this.now();
      const next = transitionSupervisorRun(current, {
        expectedRevision: current.revision,
        now,
        mutate: (draft) => {
          if (result.result) {
            applyEffectStateResult(
              draft,
              parseStateResult(result.result),
              input.effect
            );
          } else if (
            result.outcome !== "succeeded" &&
            !isAuthorityRevocationResult(result)
          ) {
            applyEffectFailureState(draft, input.effect, result);
          }
        },
      });
      try {
        const committed = await this.unitOfWork.commitEffectResult({
          transition: {
            expectedRevision: current.revision,
            snapshot: next,
            event: createWorkflowEvent(
              next,
              `workflow_effect_${result.outcome}`,
              {
                effectId: input.effect.effectId,
                effectType: input.effect.effectType,
                outcome: result.outcome,
                result: result.result ?? null,
              }
            ),
          },
          terminalEffect: {
            effectId: input.effect.effectId,
            claimToken: input.claimToken,
            status: result.outcome,
            finishedAtMs: input.finishedAtMs,
            ...(result.outcome === "succeeded" ? {} : { error: result.error }),
          },
        });
        await this.onRunCommitted?.(committed.snapshot);
        return committed.effect;
      } catch (error) {
        if (!isRevisionConflict(error)) {
          throw error;
        }
      }
    }
    return null;
  }

  private async tryCommitStateOnly(
    run: SupervisorRunState,
    mutate: (draft: SupervisorRunState) => void,
    eventType: string
  ): Promise<boolean> {
    const next = transitionSupervisorRun(run, {
      expectedRevision: run.revision,
      now: this.now(),
      mutate,
    });
    try {
      const committed = await this.unitOfWork.commitRunTransition({
        expectedRevision: run.revision,
        snapshot: next,
        event: createWorkflowEvent(next, eventType, {}),
      });
      await this.onRunCommitted?.(committed.snapshot);
      return true;
    } catch (error) {
      if (isRevisionConflict(error)) {
        return false;
      }
      throw error;
    }
  }

  private async projectUncertainAttempts(
    effects: WorkflowEffectRecord[]
  ): Promise<void> {
    for (const effect of effects) {
      const payload = parsePersistedEffectPayload(effect.payload);
      for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
        const run = await this.runs.get(effect.runId, payload.userId);
        if (!run || run.outcome) {
          break;
        }
        const located = isPromptDispatchEffect(effect.effectType)
          ? findAttemptForEffect(run, effect)
          : undefined;
        if (
          located &&
          (located.attempt.status === "terminal" ||
            (located.attempt.status === "interrupted" &&
              run.desiredState === "cancelled"))
        ) {
          break;
        }
        const next = transitionSupervisorRun(run, {
          expectedRevision: run.revision,
          now: this.now(),
          mutate: (draft) => {
            const target = isPromptDispatchEffect(effect.effectType)
              ? findAttemptForEffect(draft, effect)
              : undefined;
            if (target) {
              if (
                target.attempt.status === "terminal" ||
                (target.attempt.status === "interrupted" &&
                  draft.desiredState === "cancelled")
              ) {
                return;
              }
              target.attempt.status = "uncertain";
              target.attempt.uncertaintyId = effect.effectId;
              target.attempt.dispatchEffectId ??= effect.effectId;
              if (effect.promptHash) {
                target.attempt.promptHash ??= effect.promptHash;
              }
              clearOptional(target.attempt, "finishedAt");
              clearOptional(target.task, "outcome");
              target.task.activeAttemptId = target.attempt.attemptId;
              target.task.activity = "agent_turn";
              return;
            }
            applyEffectFailureState(draft, effect, {
              outcome: "uncertain",
              error: effect.lastError ?? {
                code: "WORKFLOW_EFFECT_OUTCOME_UNCERTAIN",
                effectId: effect.effectId,
              },
            });
          },
        });
        try {
          const committed = await this.unitOfWork.commitRunTransition({
            expectedRevision: run.revision,
            snapshot: next,
            event: createWorkflowEvent(
              next,
              "workflow_uncertain_attempt_projected",
              {
                effectId: effect.effectId,
                attemptId: located?.attempt.attemptId ?? null,
              }
            ),
          });
          await this.onRunCommitted?.(committed.snapshot);
          break;
        } catch (error) {
          if (!isRevisionConflict(error)) {
            throw error;
          }
        }
      }
    }
  }
}

export function createRunReconcilerSnapshot(
  run: SupervisorRunState,
  occupiedEffects: WorkflowEffectRecord[]
): RunReconcilerSnapshot {
  const workflowPlan = run.workflowPlan;
  const finalVerification = run.workflowFinalVerification;
  return {
    runId: run.runId,
    desiredState: run.desiredState,
    phase: run.phase,
    ...(run.outcome ? { outcome: run.outcome } : {}),
    plan: {
      goalRevisionId:
        workflowPlan?.goalRevisionId ?? stableId("goal-revision", run.runId),
      status: mapPlanStatus(workflowPlan?.status),
      ...(workflowPlan?.planVersion
        ? { planVersion: workflowPlan.planVersion }
        : {}),
      ...(workflowPlan?.blockingDecisionId
        ? { blockingDecisionId: workflowPlan.blockingDecisionId }
        : {}),
    },
    finalVerification: finalVerification
      ? structuredClone(finalVerification)
      : {
          verificationId: stableId("run-verification", run.runId),
          status: "not_started",
          evidenceRefs: [],
        },
    workItems: run.tasks.map(toWorkItemSnapshot),
    maxParallel: run.limits.maxConcurrency,
    occupiedEffectDedupeKeys: occupiedEffects
      .filter((effect) => effect.authorityId === requireAuthorityId(run))
      .map(readBaseDedupeKey),
  };
}

function toWorkItemSnapshot(task: SupervisorTaskRecord) {
  const liveAttempt = task.activeAttemptId
    ? task.attempts.find(
        (attempt) => attempt.attemptId === task.activeAttemptId
      )
    : undefined;
  const postProcessingAttempt = task.outcome
    ? undefined
    : [...task.attempts]
        .reverse()
        .find(
          (attempt) => attempt.status === "terminal" && Boolean(attempt.result)
        );
  const activeAttempt = liveAttempt ?? postProcessingAttempt;
  return {
    workItemId: task.taskId,
    dependencies: [...task.dependencies],
    ...(task.outcome
      ? {
          outcome:
            task.outcome === "succeeded"
              ? {
                  status: "succeeded" as const,
                  acceptance: task.acceptance ?? ("pending" as const),
                  evidenceRefs: task.verification?.evidenceRefs ?? [],
                }
              : {
                  status: task.outcome,
                  evidenceRefs: task.verification?.evidenceRefs ?? [],
                },
        }
      : {}),
    ...(task.notBefore ? { notBefore: task.notBefore } : {}),
    ...(activeAttempt
      ? { activeAttempt: toActiveAttemptFacts(activeAttempt) }
      : {}),
    ...(task.blockingDecisionId
      ? { blockingDecisionId: task.blockingDecisionId }
      : {}),
    ...(task.dispatch ? { dispatch: structuredClone(task.dispatch) } : {}),
    ...(task.capacityLease
      ? { capacityLease: structuredClone(task.capacityLease) }
      : {}),
    ...(task.preferredAgentId
      ? { assignedAgentIdentityId: task.preferredAgentId }
      : {}),
    ...(task.verification
      ? { verification: structuredClone(task.verification) }
      : {}),
    ...(task.integration && task.integration.status !== "not_required"
      ? {
          integration: {
            integrationId: task.integration.integrationId,
            workspaceId: task.integration.workspaceId as string,
            status: task.integration.status,
            ...(task.integration.blockingDecisionId
              ? {
                  blockingDecisionId: task.integration.blockingDecisionId,
                }
              : {}),
          },
        }
      : {}),
  };
}

function toActiveAttemptFacts(attempt: SupervisorWorkerAttempt) {
  return {
    attemptId: attempt.attemptId,
    binding: {
      chatId: attempt.chatId,
      ...(attempt.agentSessionId
        ? { agentSessionId: attempt.agentSessionId }
        : {}),
    },
    status:
      attempt.status === "terminal" || attempt.status === "interrupted"
        ? ("completed" as const)
        : attempt.status,
    ...(attempt.retryAt ? { retryAt: attempt.retryAt } : {}),
    ...(attempt.uncertaintyId ? { uncertaintyId: attempt.uncertaintyId } : {}),
  };
}

function allowedEffectAuthorities(run: SupervisorRunState): Set<string> {
  const parentAuthorityId = requireAuthorityId(run);
  const allowed = new Set<string>();
  if (run.desiredState !== "paused") {
    allowed.add(parentAuthorityId);
  }
  if (run.desiredState !== "cancelled") {
    for (const wait of run.capacityWaits) {
      if (resolveCapacityWaitBinding(run, wait.waitId)) {
        allowed.add(
          capacitySuspensionAuthorityId(parentAuthorityId, wait.waitId)
        );
      }
    }
  }
  return allowed;
}

function resolveIntentAuthority(
  run: SupervisorRunState,
  intent: WorkflowEffectIntent | OperationalEffectIntent
): string {
  return intent.type === "stop_agent_session" &&
    intent.purpose === "capacity_suspension"
    ? capacitySuspensionAuthorityId(intent.parentAuthorityId, intent.waitId)
    : requireAuthorityId(run);
}

function isCapacityResumeAllowed(
  run: SupervisorRunState,
  intent: WorkflowEffectIntent,
  occupiedEffects: WorkflowEffectRecord[]
): boolean {
  if (intent.type !== "resume_session") {
    return true;
  }
  const wait = run.capacityWaits.find(
    (candidate) =>
      candidate.owner === "task" &&
      candidate.taskId === intent.workItemId &&
      candidate.attemptId === intent.attemptId
  );
  return (
    !wait || hasSucceededCapacitySuspension(run, wait.waitId, occupiedEffects)
  );
}

function hasSucceededCapacitySuspension(
  run: SupervisorRunState,
  waitId: string,
  effects: WorkflowEffectRecord[]
): boolean {
  const binding = resolveCapacityWaitBinding(run, waitId);
  if (!binding) {
    return false;
  }
  const parentAuthorityId = requireAuthorityId(run);
  const authorityId = capacitySuspensionAuthorityId(parentAuthorityId, waitId);
  const dedupeKey = capacitySuspensionDedupeKey(
    run.runId,
    waitId,
    binding.sessionId
  );
  return effects.some(
    (effect) =>
      effect.authorityId === authorityId &&
      effect.status === "succeeded" &&
      readBaseDedupeKey(effect) === dedupeKey
  );
}

function resolveCapacityWaitBinding(
  run: SupervisorRunState,
  waitId: string
): { sessionId: string; taskId?: string; attemptId?: string } | undefined {
  const wait = run.capacityWaits.find(
    (candidate) => candidate.waitId === waitId
  );
  if (!wait) {
    return undefined;
  }
  if (wait.owner === "manager") {
    return run.managerSession?.status === "waiting_capacity"
      ? { sessionId: run.managerSession.chatId }
      : undefined;
  }
  const task = wait.taskId
    ? run.tasks.find((candidate) => candidate.taskId === wait.taskId)
    : undefined;
  const attempt =
    task && wait.attemptId
      ? task.attempts.find(
          (candidate) => candidate.attemptId === wait.attemptId
        )
      : undefined;
  return task && attempt?.status === "waiting_capacity"
    ? {
        sessionId: attempt.chatId,
        taskId: task.taskId,
        attemptId: attempt.attemptId,
      }
    : undefined;
}

function capacitySuspensionAuthorityId(
  parentAuthorityId: string,
  waitId: string
): string {
  return stableId("capacity-suspension-authority", parentAuthorityId, waitId);
}

function capacitySuspensionDedupeKey(
  runId: string,
  waitId: string,
  sessionId: string
): string {
  return effectKey(
    runId,
    "stop_agent_session",
    "capacity_suspension",
    waitId,
    sessionId
  );
}

function deriveOperationalEffects(
  run: SupervisorRunState,
  decision: RunReconcilerDecision,
  occupiedEffects: WorkflowEffectRecord[]
): OperationalEffectIntent[] {
  const parentAuthorityId = requireAuthorityId(run);
  const occupied = new Set([
    ...occupiedEffects
      .filter((effect) => effect.authorityId === parentAuthorityId)
      .map(readBaseDedupeKey),
    ...decision.effects.map((effect) => effect.dedupeKey),
  ]);
  if (run.desiredState === "cancelled" && run.cancellation) {
    return [
      ...run.cancellation.pendingSessionIds.map((sessionId) => ({
        type: "stop_agent_session" as const,
        purpose: "cancellation" as const,
        runId: run.runId,
        sessionId,
        dedupeKey: effectKey(
          run.runId,
          "stop_agent_session",
          requireAuthorityId(run),
          sessionId
        ),
      })),
      ...run.cancellation.pendingWorkspaceIds.map((workspaceId) => ({
        type: "dispose_workspace" as const,
        runId: run.runId,
        workspaceId,
        dedupeKey: effectKey(
          run.runId,
          "dispose_workspace",
          requireAuthorityId(run),
          workspaceId
        ),
      })),
    ].filter((effect) => !occupied.has(effect.dedupeKey));
  }
  const capacityStops = run.capacityWaits.flatMap((wait) => {
    const binding = resolveCapacityWaitBinding(run, wait.waitId);
    if (!binding) {
      return [];
    }
    const authorityId = capacitySuspensionAuthorityId(
      parentAuthorityId,
      wait.waitId
    );
    const dedupeKey = capacitySuspensionDedupeKey(
      run.runId,
      wait.waitId,
      binding.sessionId
    );
    const alreadyMaterialized = occupiedEffects.some(
      (effect) =>
        effect.authorityId === authorityId &&
        readBaseDedupeKey(effect) === dedupeKey
    );
    if (alreadyMaterialized) {
      return [];
    }
    return [
      {
        type: "stop_agent_session" as const,
        purpose: "capacity_suspension" as const,
        runId: run.runId,
        sessionId: binding.sessionId,
        waitId: wait.waitId,
        parentAuthorityId,
        ...(binding.taskId ? { workItemId: binding.taskId } : {}),
        ...(binding.attemptId ? { attemptId: binding.attemptId } : {}),
        dedupeKey,
      },
    ];
  });
  const managerWait = run.capacityWaits.find(
    (wait) => wait.owner === "manager"
  );
  if (
    run.desiredState === "running" &&
    run.managerSession?.status === "waiting_capacity" &&
    managerWait &&
    hasSucceededCapacitySuspension(run, managerWait.waitId, occupiedEffects)
  ) {
    const effect = {
      type: "resume_manager_session" as const,
      runId: run.runId,
      waitId: managerWait.waitId,
      retryAt: managerWait.retryAt,
      dedupeKey: effectKey(
        run.runId,
        "resume_manager_session",
        managerWait.waitId,
        managerWait.retryAt
      ),
    };
    return [
      ...capacityStops,
      ...(occupied.has(effect.dedupeKey) ? [] : [effect]),
    ];
  }
  if (
    run.desiredState === "running" &&
    run.phase === "finalizing" &&
    decision.completionEligible &&
    goalContractCriteriaAreSatisfied(run) &&
    run.finalization?.status !== "running" &&
    run.finalization?.status !== "succeeded"
  ) {
    const effect = {
      type: "create_final_commit",
      runId: run.runId,
      dedupeKey: effectKey(
        run.runId,
        "create_final_commit",
        requireAuthorityId(run),
        String(run.plan?.version ?? 1)
      ),
    } as const;
    return [
      ...capacityStops,
      ...(occupied.has(effect.dedupeKey) ? [] : [effect]),
    ];
  }
  return capacityStops;
}

function materializeEffect(input: {
  run: SupervisorRunState;
  authorityId: string;
  intent: WorkflowEffectIntent | OperationalEffectIntent;
  trustedVerificationCommands: string[];
  now: string;
}): WorkflowEffectIntentInput {
  const effectId = stableId(
    "workflow-effect",
    input.authorityId,
    input.intent.dedupeKey
  );
  const prompt = buildEffectPrompt(input.run, input.intent, {
    effectId,
    authorityId: input.authorityId,
    trustedVerificationCommands: input.trustedVerificationCommands,
  });
  const intent = jsonObject(input.intent);
  const payload: PersistedEffectPayload = {
    userId: input.run.userId,
    intent,
    ...(prompt ? { preparedPrompt: prompt } : {}),
  };
  const jsonPayload = payload as unknown as WorkflowJsonValue;
  const attemptId = stringProperty(intent, "attemptId");
  const sessionId =
    stringProperty(intent, "sessionId") ??
    objectStringProperty(intent, "binding", "agentSessionId") ??
    objectStringProperty(intent, "binding", "chatId");
  const workspaceId = stringProperty(intent, "workspaceId");
  let notBefore = Date.parse(input.now);
  if (input.intent.type === "schedule_wakeup") {
    notBefore = Date.parse(input.intent.at);
  } else if (input.intent.type === "resume_manager_session") {
    notBefore = Date.parse(input.intent.retryAt);
  }
  return {
    effectId,
    authorityId: input.authorityId,
    effectType: input.intent.type,
    payloadVersion: 1,
    payload: jsonPayload,
    payloadHash: computeWorkflowPayloadHash(jsonPayload),
    ...(prompt ? { promptHash: prompt.promptHash } : {}),
    idempotencyKey: input.intent.dedupeKey,
    notBeforeMs: Number.isFinite(notBefore) ? notBefore : Date.parse(input.now),
    ...(attemptId ? { attemptId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    createdAtMs: Date.parse(input.now),
  };
}

function buildEffectPrompt(
  run: SupervisorRunState,
  intent: WorkflowEffectIntent | OperationalEffectIntent,
  input: {
    effectId: string;
    authorityId: string;
    trustedVerificationCommands: string[];
  }
): PreparedSupervisorPrompt | undefined {
  let text: string | undefined;
  if (intent.type === "request_plan") {
    text = buildAcpManagerPrompt({
      run,
      turnKind: run.plan ? "replan" : "plan",
      trustedVerificationCommands: input.trustedVerificationCommands,
      ...(latestRequestedChanges(run)
        ? { requestedChanges: latestRequestedChanges(run) }
        : {}),
    });
  } else if (intent.type === "resume_manager_session") {
    text = buildAcpManagerPrompt({
      run,
      turnKind: run.managerSession?.pendingTurnKind ?? "replan",
      trustedVerificationCommands: input.trustedVerificationCommands,
      ...(latestRequestedChanges(run)
        ? { requestedChanges: latestRequestedChanges(run) }
        : {}),
    });
  } else if (intent.type === "start_turn") {
    const task = requireTask(run, intent.workItemId);
    text = buildWorkerPrompt({
      run,
      task,
      dependencySummaries: collectDependencySummaries(run, task),
    });
  } else if (intent.type === "resume_session") {
    const task = requireTask(run, intent.workItemId);
    const attempt = requireAttempt(task, intent.attemptId);
    text = attempt.turnId
      ? buildWorkerResumePrompt(task)
      : buildWorkerPrompt({
          run,
          task,
          dependencySummaries: collectDependencySummaries(run, task),
        });
  }
  return text
    ? {
        effectId: input.effectId,
        authorityId: input.authorityId,
        text,
        promptHash: computeSupervisorPromptHash(text),
      }
    : undefined;
}

function markEffectMaterialized(
  run: SupervisorRunState,
  intent: WorkflowEffectIntent | OperationalEffectIntent | undefined,
  effect: WorkflowEffectIntentInput | undefined
): void {
  if (!(intent && effect)) {
    return;
  }
  switch (intent.type) {
    case "request_plan":
      if (run.workflowPlan) {
        run.workflowPlan.status = "requested";
      }
      run.activity = "planning";
      return;
    case "request_capacity": {
      const task = requireTask(run, intent.workItemId);
      task.dispatch = {
        dispatchId: intent.dispatchId ?? stableId("dispatch", intent.dedupeKey),
        state: "capacity_requested",
        effectId: effect.effectId,
      };
      task.activity = "dispatching";
      return;
    }
    case "start_turn": {
      const task = requireTask(run, intent.workItemId);
      if (task.dispatch) {
        task.dispatch.state = "start_requested";
        task.dispatch.effectId = effect.effectId;
      }
      return;
    }
    case "resume_session": {
      const task = requireTask(run, intent.workItemId);
      const attempt = requireAttempt(task, intent.attemptId);
      attempt.dispatchEffectId = effect.effectId;
      if (effect.promptHash) {
        attempt.promptHash = effect.promptHash;
      }
      return;
    }
    case "resume_manager_session":
      return;
    case "inspect_uncertain_turn":
    case "request_decision":
    case "schedule_wakeup":
      return;
    case "run_verification":
      if (intent.scope === "run") {
        if (run.workflowFinalVerification) {
          run.workflowFinalVerification.status = "running";
        }
      } else if (intent.workItemId) {
        const task = requireTask(run, intent.workItemId);
        if (task.verification) {
          task.verification.status = "running";
        }
        task.activity = "verification";
      }
      return;
    case "integrate_workspace": {
      const task = requireTask(run, intent.workItemId);
      if (task.integration) {
        task.integration.status = "running";
        task.integration.effectId = effect.effectId;
      }
      task.activity = "integration";
      return;
    }
    case "stop_agent_session":
      markStopEffectMaterialized(run, intent);
      return;
    case "dispose_workspace":
      if (run.cancellation) {
        run.cancellation.status = "running";
      }
      return;
    case "create_final_commit":
      run.finalization = { status: "running", effectId: effect.effectId };
      return;
    default:
      assertNever(intent);
  }
}

function markStopEffectMaterialized(
  run: SupervisorRunState,
  intent: Extract<OperationalEffectIntent, { type: "stop_agent_session" }>
): void {
  if (intent.purpose === "cancellation" && run.cancellation) {
    run.cancellation.status = "running";
  }
}

function assertEffectStillApplicable(
  run: SupervisorRunState,
  effect: WorkflowEffectRecord,
  intent: Record<string, WorkflowJsonValue>
): void {
  const taskId = stringProperty(intent, "workItemId");
  if (taskId && !run.tasks.some((task) => task.taskId === taskId)) {
    throw new Error(`Workflow effect task no longer exists: ${taskId}`);
  }
  if (
    effect.effectType === "create_final_commit" &&
    run.phase !== "finalizing"
  ) {
    throw new Error("Final commit effect is no longer applicable");
  }
  if (
    effect.effectType === "create_final_commit" &&
    !goalContractCriteriaAreSatisfied(run)
  ) {
    throw new Error(
      "Final commit effect is blocked by unresolved Goal Contract criteria"
    );
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each typed effect owns a small, explicit failure projection; keeping the exhaustive routing together prevents silent fallthrough.
function applyEffectFailureState(
  run: SupervisorRunState,
  effect: WorkflowEffectRecord,
  result: Exclude<WorkflowEffectHandlerResult, { outcome: "succeeded" }>
): void {
  const payload = parsePersistedEffectPayload(effect.payload);
  const taskId = stringProperty(payload.intent, "workItemId");
  const attemptId =
    effect.attemptId ?? stringProperty(payload.intent, "attemptId");
  const decisionId = `${effect.effectId}-failure`;
  const reason = workflowFailureMessage(effect, result);

  if (
    effect.effectType === "stop_agent_session" &&
    stringProperty(payload.intent, "purpose") === "capacity_suspension"
  ) {
    appendWorkflowDecision(run, decisionId, reason);
    const waitId = stringProperty(payload.intent, "waitId");
    const wait = run.capacityWaits.find(
      (candidate) => candidate.waitId === waitId
    );
    if (wait?.owner === "task" && wait.taskId) {
      requireTask(run, wait.taskId).blockingDecisionId = decisionId;
    } else if (wait?.owner === "manager" && run.phase === "planning") {
      run.blockingDecisionId = decisionId;
    }
    return;
  }

  if (effect.effectType === "request_capacity" && taskId) {
    const task = requireTask(run, taskId);
    const retryAt = new Date(Date.parse(run.updatedAt) + 60_000).toISOString();
    task.dispatch = {
      dispatchId: stableId("dispatch-retry", effect.effectId),
      state: "capacity_requested",
      retryAt,
    };
    task.notBefore = retryAt;
    task.activity = "capacity_wait";
    return;
  }
  if (effect.effectType === "start_turn" && taskId) {
    const task = requireTask(run, taskId);
    const attempt = task.attempts.find(
      (candidate) => candidate.idempotencyKey === effect.effectId
    );
    if (attempt) {
      attempt.status = "uncertain";
      attempt.uncertaintyId = effect.effectId;
      clearOptional(attempt, "finishedAt");
      clearOptional(task, "outcome");
      task.activeAttemptId = attempt.attemptId;
      task.activity = "agent_turn";
    } else {
      const retryAt = new Date(
        Date.parse(run.updatedAt) + 60_000
      ).toISOString();
      task.dispatch = {
        dispatchId: stableId("dispatch-retry", effect.effectId),
        state: "capacity_requested",
        retryAt,
      };
      clearOptional(task, "capacityLease");
      task.notBefore = retryAt;
      task.activity = "capacity_wait";
    }
    return;
  }
  if (effect.effectType === "resume_session" && taskId && attemptId) {
    const task = requireTask(run, taskId);
    const attempt = requireAttempt(task, attemptId);
    if (result.outcome === "uncertain") {
      attempt.status = "uncertain";
      attempt.uncertaintyId = effect.effectId;
      task.activity = "agent_turn";
    } else {
      const minimumRetryAtMs = Date.parse(run.updatedAt) + 60_000;
      const persistedRetryAtMs = attempt.retryAt
        ? Date.parse(attempt.retryAt)
        : Number.NaN;
      const retryAt = new Date(
        Number.isFinite(persistedRetryAtMs) &&
          persistedRetryAtMs > Date.parse(run.updatedAt)
          ? persistedRetryAtMs
          : minimumRetryAtMs
      ).toISOString();
      attempt.status = "waiting_capacity";
      attempt.retryAt = retryAt;
      clearOptional(attempt, "uncertaintyId");
      task.notBefore = retryAt;
      task.activity = "capacity_wait";
    }
    return;
  }
  if (
    effect.effectType === "resume_manager_session" &&
    run.managerSession?.status === "waiting_capacity" &&
    run.capacityWaits.some((wait) => wait.owner === "manager")
  ) {
    const managerWait = run.capacityWaits.find(
      (wait) => wait.owner === "manager"
    );
    if (
      managerWait &&
      Date.parse(managerWait.retryAt) <= Date.parse(run.updatedAt)
    ) {
      managerWait.retryAt = new Date(
        Date.parse(run.updatedAt) + 60_000
      ).toISOString();
      managerWait.backoffStep = Math.min(64, managerWait.backoffStep + 1);
    }
    if (run.phase === "planning") {
      run.activity = "capacity_wait";
    }
    return;
  }

  appendWorkflowDecision(run, decisionId, reason);
  if (effect.effectType === "request_plan") {
    if (run.workflowPlan) {
      run.workflowPlan.status = "failed";
      run.workflowPlan.blockingDecisionId = decisionId;
    }
    run.blockingDecisionId = decisionId;
  } else if (effect.effectType === "run_verification") {
    if (taskId) {
      const task = requireTask(run, taskId);
      if (task.verification) {
        task.verification.status = "failed";
        task.verification.blockingDecisionId = decisionId;
      }
      task.blockingDecisionId = decisionId;
      clearOptional(task, "activity");
    } else if (run.workflowFinalVerification) {
      run.workflowFinalVerification.status = "failed";
      run.workflowFinalVerification.blockingDecisionId = decisionId;
      run.blockingDecisionId = decisionId;
    }
  } else if (effect.effectType === "integrate_workspace" && taskId) {
    const task = requireTask(run, taskId);
    if (task.integration) {
      task.integration.status = "failed";
      task.integration.blockingDecisionId = decisionId;
    }
    task.blockingDecisionId = decisionId;
  } else if (
    effect.effectType === "stop_agent_session" ||
    effect.effectType === "dispose_workspace"
  ) {
    if (run.cancellation) {
      run.cancellation.status = "failed";
      run.cancellation.blockingDecisionId = decisionId;
    }
    run.blockingDecisionId = decisionId;
  } else if (effect.effectType === "create_final_commit") {
    run.finalization = {
      status: "failed",
      effectId: effect.effectId,
      blockingDecisionId: decisionId,
    };
    run.blockingDecisionId = decisionId;
  } else if (effect.effectType === "inspect_uncertain_turn" && taskId) {
    requireTask(run, taskId).blockingDecisionId = decisionId;
  } else if (effect.effectType === "resume_manager_session") {
    run.blockingDecisionId = decisionId;
  }
}

function workflowFailureMessage(
  effect: WorkflowEffectRecord,
  result: Exclude<WorkflowEffectHandlerResult, { outcome: "succeeded" }>
): string {
  const error = result.error;
  const message =
    typeof error === "object" &&
    error !== null &&
    !Array.isArray(error) &&
    typeof error.message === "string"
      ? error.message
      : `Workflow effect ${effect.effectType} ${result.outcome}`;
  return message.slice(0, 8000);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This exhaustive typed-result reducer deliberately centralizes canonical state projection for atomic UoW commits.
function applyEffectStateResult(
  run: SupervisorRunState,
  result: SupervisorWorkflowStateResult,
  effect: WorkflowEffectRecord
): void {
  switch (result.kind) {
    case "wakeup_observed":
      return;
    case "plan_requested":
      if (run.workflowPlan) {
        run.workflowPlan.status = "requested";
      }
      return;
    case "manager_session_resumed":
      if (run.managerSession) {
        run.managerSession.status = "running";
      }
      run.capacityWaits = run.capacityWaits.filter(
        (wait) => wait.waitId !== result.waitId
      );
      if (run.phase === "planning") {
        run.activity = "planning";
      }
      return;
    case "capacity_observed": {
      const task = requireTask(run, result.taskId);
      const dispatchId =
        task.dispatch?.dispatchId ?? stableId("dispatch", effect.effectId);
      if (!result.available) {
        task.dispatch = {
          dispatchId,
          state: "capacity_requested",
          effectId: effect.effectId,
          ...(result.retryAt ? { retryAt: result.retryAt } : {}),
        };
        if (result.retryAt) {
          task.notBefore = result.retryAt;
        }
        task.activity = "capacity_wait";
        return;
      }
      const issuedAt = run.updatedAt;
      task.dispatch = {
        dispatchId,
        state: "leased",
        effectId: effect.effectId,
      };
      task.capacityLease = {
        leaseId: stableId("capacity-lease", effect.effectId),
        agentIdentityId: result.agentIdentityId,
        issuedAt,
        expiresAt: new Date(
          Date.parse(issuedAt) + DEFAULT_CAPACITY_LEASE_MS
        ).toISOString(),
      };
      task.preferredAgentId = result.agentIdentityId;
      task.activity = "dispatching";
      clearOptional(task, "notBefore");
      return;
    }
    case "turn_started": {
      const task = requireTask(run, result.taskId);
      const attempt = requireAttempt(task, result.attemptId);
      task.activeAttemptId = attempt.attemptId;
      task.activity = "agent_turn";
      clearOptional(task, "dispatch");
      clearOptional(task, "capacityLease");
      return;
    }
    case "session_resumed": {
      const task = requireTask(run, result.taskId);
      const attempt = requireAttempt(task, result.attemptId);
      attempt.status = "running";
      clearOptional(attempt, "retryAt");
      clearOptional(attempt, "uncertaintyId");
      task.activeAttemptId = attempt.attemptId;
      task.activity = "agent_turn";
      clearOptional(task, "notBefore");
      return;
    }
    case "uncertain_turn_inspected": {
      const task = requireTask(run, result.taskId);
      const attempt = requireAttempt(task, result.attemptId);
      clearOptional(attempt, "uncertaintyId");
      if (result.disposition === "running") {
        attempt.status = "running";
        task.activity = "agent_turn";
      } else if (result.disposition === "waiting_capacity") {
        attempt.status = "waiting_capacity";
        if (result.retryAt) {
          attempt.retryAt = result.retryAt;
          task.notBefore = result.retryAt;
        }
        task.activity = "capacity_wait";
      } else {
        attempt.status = "interrupted";
        attempt.finishedAt = run.updatedAt;
        clearOptional(task, "activeAttemptId");
        if (result.decisionId) {
          task.blockingDecisionId = result.decisionId;
          if (
            !run.decisions.some(
              (decision) => decision.decisionId === result.decisionId
            )
          ) {
            run.decisions.push({
              decisionId: result.decisionId,
              kind: "classifier_uncertain",
              status: "open",
              prompt:
                "The previous ACP dispatch outcome could not be proven; review the persisted session and workspace evidence before continuing.",
              createdAt: run.updatedAt,
            });
          }
        }
        clearOptional(task, "activity");
      }
      return;
    }
    case "verification_completed": {
      if (result.scope === "run") {
        if (!run.workflowFinalVerification) {
          throw new Error("Run verification facts are missing");
        }
        run.workflowFinalVerification.status = result.passed
          ? "passed"
          : "failed";
        run.workflowFinalVerification.evidenceRefs = [...result.evidenceRefs];
        run.finalVerification = structuredClone(result.evidence);
        if (!result.passed && result.decisionId) {
          appendWorkflowDecision(
            run,
            result.decisionId,
            result.reason ?? "Final verification failed"
          );
          run.workflowFinalVerification.blockingDecisionId = result.decisionId;
          run.blockingDecisionId = result.decisionId;
        }
        return;
      }
      if (!result.taskId) {
        throw new Error("Work-item verification result requires taskId");
      }
      const task = requireTask(run, result.taskId);
      if (!task.verification) {
        throw new Error(`Task ${task.taskId} verification facts are missing`);
      }
      task.verification.status = result.passed ? "passed" : "failed";
      task.verification.evidenceRefs = [...result.evidenceRefs];
      const resultAttempt = task.attempts.at(-1);
      if (resultAttempt?.result) {
        resultAttempt.result.verification = structuredClone(result.evidence);
      }
      if (result.passed) {
        task.acceptance = "machine_verified";
        const attempt = task.activeAttemptId
          ? task.attempts.find(
              (candidate) => candidate.attemptId === task.activeAttemptId
            )
          : task.attempts.at(-1);
        if (task.executionMode === "write" && attempt?.workspace) {
          task.integration = {
            integrationId: stableId(
              "integration",
              run.runId,
              task.taskId,
              attempt.attemptId
            ),
            status: "pending",
            workspaceId: attempt.workspace.workspaceId,
          };
          task.activity = "integration";
        } else {
          task.integration = {
            integrationId: stableId(
              "integration",
              run.runId,
              task.taskId,
              "not-required"
            ),
            status: "not_required",
          };
          task.outcome = "succeeded";
          clearOptional(task, "activity");
        }
      } else {
        task.acceptance = "pending";
        clearOptional(task, "activity");
        if (result.decisionId) {
          appendWorkflowDecision(
            run,
            result.decisionId,
            result.reason ?? "Work-item verification requires review"
          );
          task.verification.blockingDecisionId = result.decisionId;
          task.blockingDecisionId = result.decisionId;
        }
      }
      return;
    }
    case "decision_requested":
      if (result.taskId) {
        requireTask(run, result.taskId).blockingDecisionId = result.decisionId;
      } else if (
        run.decisions.some(
          (decision) =>
            decision.decisionId === result.decisionId &&
            decision.status === "open"
        )
      ) {
        run.blockingDecisionId = result.decisionId;
      }
      return;
    case "integration_completed": {
      const task = requireTask(run, result.taskId);
      if (!task.integration) {
        throw new Error(`Task ${task.taskId} integration facts are missing`);
      }
      task.integration.status = result.passed ? "succeeded" : "failed";
      const integrationAttempt = task.attempts.at(-1);
      if (integrationAttempt?.result) {
        if (result.files) {
          integrationAttempt.result.files = structuredClone(result.files);
        }
        if (result.patch) {
          integrationAttempt.result.patch = structuredClone(result.patch);
        }
      }
      if (result.passed) {
        task.outcome = "succeeded";
        task.acceptance ??= "machine_verified";
        clearOptional(task, "activity");
        clearOptional(task, "activeAttemptId");
        Object.assign(
          run.deliveryFingerprints,
          result.deliveryFingerprints ?? {}
        );
      } else if (result.decisionId) {
        task.integration.blockingDecisionId = result.decisionId;
        task.blockingDecisionId = result.decisionId;
        appendWorkflowDecision(
          run,
          result.decisionId,
          result.reason ?? "Workspace integration requires review",
          "conflict"
        );
      }
      return;
    }
    case "agent_session_stopped":
      if (run.cancellation) {
        run.cancellation.pendingSessionIds =
          run.cancellation.pendingSessionIds.filter(
            (sessionId) => sessionId !== result.sessionId
          );
      }
      return;
    case "workspace_disposed":
      if (run.cancellation) {
        run.cancellation.pendingWorkspaceIds =
          run.cancellation.pendingWorkspaceIds.filter(
            (workspaceId) => workspaceId !== result.workspaceId
          );
      }
      return;
    case "final_commit_created":
      if (!goalContractCriteriaAreSatisfied(run)) {
        throw new Error(
          "Final commit result cannot complete unresolved Goal Contract criteria"
        );
      }
      run.finalCommitSha = result.commitSha;
      run.finalization = { status: "succeeded", effectId: effect.effectId };
      run.phase = "finished";
      run.outcome = "succeeded";
      clearOptional(run, "activity");
      return;
    default:
      assertNever(result);
  }
}

function parseStateResult(
  value: WorkflowJsonValue
): SupervisorWorkflowStateResult {
  return SupervisorWorkflowStateResultSchema.parse(value);
}

function goalCriterionDecision(
  run: SupervisorRunState
): SupervisorRunState["decisions"][number] | undefined {
  if (!run.sourceGoalContract) {
    return undefined;
  }
  const assessment = assessGoalContractCriteria(run);
  const planVersion = String(run.plan?.version ?? 0);
  if (assessment.pendingMachineCriterionIds.length > 0) {
    const criterionIds = assessment.pendingMachineCriterionIds;
    return {
      decisionId: stableId(
        "goal-criterion-evidence",
        run.runId,
        planVersion,
        ...criterionIds
      ),
      kind: "goal_criterion_evidence",
      status: "open",
      criterionIds,
      prompt: [
        "The approved Goal Contract is not eligible for completion because machine evidence is missing.",
        `Criteria: ${criterionIds.join(", ")}.`,
        "Retry failed verification or request a replan that maps each criterion to a work item with passed trusted evidence.",
      ].join(" "),
      createdAt: run.updatedAt,
    };
  }
  if (assessment.pendingUserCriterionIds.length > 0) {
    const criterionIds = assessment.pendingUserCriterionIds;
    return {
      decisionId: stableId(
        "goal-criteria-acceptance",
        run.runId,
        planVersion,
        ...criterionIds
      ),
      kind: "goal_criteria_acceptance",
      status: "open",
      criterionIds,
      prompt: [
        "Explicit semantic acceptance is required before this Goal can complete.",
        `Review criteria: ${criterionIds.join(", ")}.`,
        "Choose Accept only when every listed criterion is satisfied, or Waive with a reason. Free-form text without the explicit resolution is not acceptance.",
      ].join(" "),
      createdAt: run.updatedAt,
    };
  }
  return undefined;
}

export function resolveRunVerificationCommands(
  run: Pick<SupervisorRunState, "sourceGoalContract">,
  configuredCommands: string[]
): string[] {
  return [
    ...new Set(
      run.sourceGoalContract?.contract
        ? run.sourceGoalContract.contract.trustedVerificationCommands
        : configuredCommands
    ),
  ];
}

function appendWorkflowDecision(
  run: SupervisorRunState,
  decisionId: string,
  prompt: string,
  kind: SupervisorRunState["decisions"][number]["kind"] = "classifier_uncertain"
): void {
  if (run.decisions.some((decision) => decision.decisionId === decisionId)) {
    return;
  }
  run.decisions.push({
    decisionId,
    kind,
    status: "open",
    prompt,
    createdAt: run.updatedAt,
  });
}

function parsePersistedEffectPayload(
  value: WorkflowJsonValue
): PersistedEffectPayload {
  if (!(typeof value === "object" && value !== null && !Array.isArray(value))) {
    throw new Error("Workflow effect payload must be an object");
  }
  const userId = value.userId;
  const intent = value.intent;
  if (
    typeof userId !== "string" ||
    !(typeof intent === "object" && intent !== null && !Array.isArray(intent))
  ) {
    throw new Error("Workflow effect payload is missing its durable context");
  }
  const prepared = value.preparedPrompt;
  return {
    userId,
    intent,
    ...(isPreparedPrompt(prepared) ? { preparedPrompt: prepared } : {}),
  };
}

function readBaseDedupeKey(effect: WorkflowEffectRecord): string {
  try {
    const intent = parsePersistedEffectPayload(effect.payload).intent;
    return stringProperty(intent, "dedupeKey") ?? effect.idempotencyKey;
  } catch {
    return effect.idempotencyKey;
  }
}

function isPreparedPrompt(value: unknown): value is PreparedSupervisorPrompt {
  return (
    typeof value === "object" &&
    value !== null &&
    "effectId" in value &&
    typeof value.effectId === "string" &&
    "authorityId" in value &&
    typeof value.authorityId === "string" &&
    "text" in value &&
    typeof value.text === "string" &&
    "promptHash" in value &&
    typeof value.promptHash === "string"
  );
}

function createWorkflowEvent(
  run: SupervisorRunState,
  eventType: string,
  payload: WorkflowJsonValue
) {
  return {
    eventId: stableId(
      "workflow-event",
      run.runId,
      String(run.revision),
      eventType
    ),
    runId: run.runId,
    revision: run.revision,
    eventType,
    payloadVersion: 1,
    payload,
    occurredAtMs: Date.parse(run.updatedAt),
  };
}

function mapPlanStatus(
  status: SupervisorRunState["workflowPlan"] extends infer _T
    ? NonNullable<SupervisorRunState["workflowPlan"]>["status"] | undefined
    : never
): RunReconcilerSnapshot["plan"]["status"] {
  if (status === "approved") {
    return "approved";
  }
  if (status === "proposed" || status === "available") {
    return "proposed";
  }
  if (status === "requested" || status === "failed") {
    return "requested";
  }
  return "missing";
}

function requireAuthorityId(run: SupervisorRunState): string {
  return (
    run.workflowPlan?.authorityId ??
    stableId("workflow-authority", run.runId, String(run.plan?.version ?? 1))
  );
}

function latestRequestedChanges(run: SupervisorRunState): string | undefined {
  return [...run.audit]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "plan_changes_requested" ||
        entry.kind === "decision_answered"
    )?.summary;
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
      throw new Error(`Dependency ${dependencyId} has no structured result`);
    }
    return { taskId: dependencyId, summary };
  });
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

function requireAttempt(
  task: SupervisorTaskRecord,
  attemptId: string
): SupervisorWorkerAttempt {
  const attempt = task.attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (!attempt) {
    throw new Error(`Supervisor worker attempt not found: ${attemptId}`);
  }
  return attempt;
}

function findAttempt(run: SupervisorRunState, attemptId: string) {
  for (const task of run.tasks) {
    const attempt = task.attempts.find(
      (candidate) => candidate.attemptId === attemptId
    );
    if (attempt) {
      return { task, attempt };
    }
  }
  return undefined;
}

function findAttemptForEffect(
  run: SupervisorRunState,
  effect: WorkflowEffectRecord
) {
  if (effect.attemptId) {
    const direct = findAttempt(run, effect.attemptId);
    if (direct) {
      return direct;
    }
  }
  for (const task of run.tasks) {
    const attempt = task.attempts.find(
      (candidate) =>
        candidate.dispatchEffectId === effect.effectId ||
        candidate.idempotencyKey === effect.effectId
    );
    if (attempt) {
      return { task, attempt };
    }
  }
  return undefined;
}

function isAttemptInFlight(attempt: SupervisorWorkerAttempt): boolean {
  return (
    attempt.status === "starting" ||
    attempt.status === "running" ||
    attempt.status === "waiting_capacity" ||
    attempt.status === "uncertain"
  );
}

function isPromptDispatchEffect(effectType: string): boolean {
  return effectType === "start_turn" || effectType === "resume_session";
}

function workflowEffectAuthorityFailure(
  run: SupervisorRunState,
  effect: WorkflowEffectRecord
): string | undefined {
  const intent = parsePersistedEffectPayload(effect.payload).intent;
  if (
    effect.effectType === "stop_agent_session" &&
    stringProperty(intent, "purpose") === "capacity_suspension"
  ) {
    const waitId = stringProperty(intent, "waitId");
    const sessionId = stringProperty(intent, "sessionId");
    const parentAuthorityId = stringProperty(intent, "parentAuthorityId");
    const binding = waitId
      ? resolveCapacityWaitBinding(run, waitId)
      : undefined;
    if (
      run.outcome ||
      run.desiredState === "cancelled" ||
      !waitId ||
      !sessionId ||
      !parentAuthorityId ||
      requireAuthorityId(run) !== parentAuthorityId ||
      effect.authorityId !==
        capacitySuspensionAuthorityId(parentAuthorityId, waitId) ||
      binding?.sessionId !== sessionId
    ) {
      return "WORKFLOW_EFFECT_AUTHORITY_REVOKED";
    }
    return undefined;
  }
  const cancellationEffect =
    effect.effectType === "stop_agent_session" ||
    effect.effectType === "dispose_workspace";
  if (
    run.outcome ||
    requireAuthorityId(run) !== effect.authorityId ||
    (cancellationEffect
      ? run.desiredState !== "cancelled"
      : run.desiredState !== "running")
  ) {
    return "WORKFLOW_EFFECT_AUTHORITY_REVOKED";
  }
  return undefined;
}

function failedAuthorityResult(
  code: string,
  effect: WorkflowEffectRecord
): WorkflowEffectHandlerResult {
  return {
    outcome: "failed",
    error: {
      code,
      effectId: effect.effectId,
      authorityId: effect.authorityId,
    },
  };
}

function isAuthorityRevocationResult(
  result: WorkflowEffectHandlerResult
): boolean {
  if (result.outcome !== "failed") {
    return false;
  }
  const error = result.error;
  return (
    typeof error === "object" &&
    error !== null &&
    !Array.isArray(error) &&
    (error.code === "WORKFLOW_EFFECT_AUTHORITY_REVOKED" ||
      error.code === "WORKFLOW_RUN_NOT_FOUND")
  );
}

function jsonObject(value: object): Record<string, WorkflowJsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, WorkflowJsonValue>;
}

function stringProperty(
  value: Record<string, WorkflowJsonValue>,
  key: string
): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function objectStringProperty(
  value: Record<string, WorkflowJsonValue>,
  objectKey: string,
  key: string
): string | undefined {
  const object = value[objectKey];
  return typeof object === "object" &&
    object !== null &&
    !Array.isArray(object) &&
    typeof object[key] === "string"
    ? object[key]
    : undefined;
}

function effectKey(...parts: string[]): string {
  return parts.join(":");
}

function stableId(prefix: string, ...parts: string[]): string {
  const hash = CryptoHasher.hash("sha256", parts.join("\0"), "hex");
  return `${prefix}-${hash}`;
}

function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof SupervisorRunRevisionConflictError ||
    (error instanceof Error &&
      (error.name === "WorkflowJournalConflictError" ||
        ("code" in error && error.code === "WORKFLOW_JOURNAL_CONFLICT")))
  );
}

function clearOptional(object: object, key: PropertyKey): void {
  Reflect.deleteProperty(object, key);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported workflow intent: ${String(value)}`);
}

export const SUPERVISOR_WORKFLOW_OPERATIONAL_EFFECT_TYPES: readonly OperationalEffectType[] =
  [
    "stop_agent_session",
    "dispose_workspace",
    "create_final_commit",
    "resume_manager_session",
  ];

export const SUPERVISOR_WORKFLOW_CAPACITY_LEASE_MS = DEFAULT_CAPACITY_LEASE_MS;
