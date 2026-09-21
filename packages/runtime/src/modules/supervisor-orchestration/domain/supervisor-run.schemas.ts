import { z } from "zod";

export const SUPERVISOR_RUN_SCHEMA_VERSION = 3 as const;
export const SUPERVISOR_RUN_LIMIT_DEFAULTS = {
  maxConcurrency: 2,
  maxTasks: 12,
  maxAttemptsPerTask: 2,
  maxPlannerReplans: 2,
} as const;
export const SUPERVISOR_RUN_LIMIT_CAPS = {
  maxConcurrency: 8,
  maxTasks: 32,
  maxAttemptsPerTask: 5,
  maxPlannerReplans: 5,
} as const;
export const SUPERVISOR_MAX_DEPENDENCY_DEPTH = 16;

const IdentifierSchema = z.string().trim().min(1).max(160);
const TimestampSchema = z.string().datetime({ offset: true });
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !value.includes("\0"), "Paths cannot contain NUL");

export const SupervisorRunStatusSchema = z.enum([
  "draft",
  "planning",
  "awaiting_approval",
  "queued",
  "running",
  "waiting_capacity",
  "paused",
  "needs_user",
  "completing",
  "completed",
  "failed",
  "cancelled",
]);

export const SupervisorTaskStatusSchema = z.enum([
  "blocked",
  "ready",
  "queued",
  "running",
  "waiting_capacity",
  "reviewing",
  "integrating",
  "completed",
  "needs_user",
  "failed",
  "cancelled",
]);

export const SupervisorTaskRoleSchema = z.enum([
  "research",
  "implementation",
  "test",
  "review",
  "integration",
]);

export const SupervisorTaskExecutionModeSchema = z.enum(["read_only", "write"]);

export const SupervisorGoalCriterionEvidenceSchema = z.enum([
  "machine",
  "user",
]);

export const SupervisorGoalAuthorityPolicySchema = z
  .object({
    scopedCodeChange: z.enum(["auto", "ask"]),
    architectureChange: z.enum(["auto", "ask"]),
    dependencyChange: z.enum(["auto", "ask"]),
    destructiveAction: z.literal("ask"),
    finalIntegration: z.enum(["auto", "ask"]),
  })
  .strict();

export const SupervisorGoalContractSnapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(16_000),
    lockedStrategicDecisions: z
      .array(z.string().trim().min(1).max(4000))
      .max(64),
    assumptions: z.array(z.string().trim().min(1).max(4000)).max(64),
    nonGoals: z.array(z.string().trim().min(1).max(4000)).max(64),
    changeBoundary: z.array(z.string().trim().min(1).max(4096)).max(256),
    acceptanceCriteria: z
      .array(
        z
          .object({
            criterionId: IdentifierSchema,
            statement: z.string().trim().min(1).max(4000),
            evidence: SupervisorGoalCriterionEvidenceSchema,
          })
          .strict()
      )
      .min(1)
      .max(128),
    trustedVerificationCommands: z
      .array(z.string().trim().min(1).max(4096))
      .max(64),
    authority: SupervisorGoalAuthorityPolicySchema,
    unresolvedQuestions: z.array(z.string().trim().min(1).max(4000)).max(64),
  })
  .strict()
  .superRefine((contract, context) => {
    const criterionIds = contract.acceptanceCriteria.map(
      (criterion) => criterion.criterionId
    );
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptanceCriteria"],
        message: "Goal Contract criterion ids must be unique",
      });
    }
  });

export const SupervisorTaskChangeKindSchema = z.enum([
  "scoped_code_change",
  "architecture_change",
  "dependency_change",
  "final_integration",
]);

export const SupervisorRunDesiredStateSchema = z.enum([
  "running",
  "paused",
  "cancelled",
]);

export const SupervisorRunPhaseSchema = z.enum([
  "planning",
  "executing",
  "finalizing",
  "finished",
]);

export const SupervisorRunOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "cancelled",
]);

export const SupervisorRunActivitySchema = z.enum([
  "planning",
  "dispatching",
  "executing",
  "capacity_wait",
  "finalizing",
]);

export const SupervisorTaskActivitySchema = z.enum([
  "dispatching",
  "agent_turn",
  "capacity_wait",
  "verification",
  "integration",
]);

export const SupervisorWorkflowPlanSchema = z
  .object({
    goalRevisionId: IdentifierSchema,
    authorityId: IdentifierSchema,
    status: z.enum([
      "missing",
      "requested",
      "available",
      "proposed",
      "approved",
      "failed",
    ]),
    planVersion: z.number().int().positive().optional(),
    blockingDecisionId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.status === "failed" && !plan.blockingDecisionId) {
      context.addIssue({
        code: "custom",
        path: ["blockingDecisionId"],
        message: "Failed planning requires a blocking decision",
      });
    }
  });

export const SupervisorWorkflowVerificationSchema = z
  .object({
    verificationId: IdentifierSchema,
    status: z.enum([
      "not_required",
      "not_started",
      "running",
      "passed",
      "failed",
      "accepted",
    ]),
    evidenceRefs: z.array(IdentifierSchema).max(4096),
    blockingDecisionId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((verification, context) => {
    if (verification.status === "failed" && !verification.blockingDecisionId) {
      context.addIssue({
        code: "custom",
        path: ["blockingDecisionId"],
        message: "Failed verification requires a blocking decision",
      });
    }
  });

export const SupervisorWorkflowDispatchSchema = z
  .object({
    dispatchId: IdentifierSchema,
    state: z.enum(["capacity_requested", "leased", "start_requested"]),
    effectId: IdentifierSchema.optional(),
    retryAt: TimestampSchema.optional(),
  })
  .strict();

export const SupervisorWorkflowCapacityLeaseSchema = z
  .object({
    leaseId: IdentifierSchema,
    agentIdentityId: IdentifierSchema,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .refine(
    (lease) => Date.parse(lease.expiresAt) > Date.parse(lease.issuedAt),
    "Capacity lease must expire after it is issued"
  );

export const SupervisorWorkflowIntegrationSchema = z
  .object({
    integrationId: IdentifierSchema,
    status: z.enum([
      "not_required",
      "pending",
      "running",
      "succeeded",
      "failed",
    ]),
    workspaceId: IdentifierSchema.optional(),
    effectId: IdentifierSchema.optional(),
    blockingDecisionId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((integration, context) => {
    if (integration.status !== "not_required" && !integration.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["workspaceId"],
        message: "Active integration requires a workspace id",
      });
    }
    if (integration.status === "failed" && !integration.blockingDecisionId) {
      context.addIssue({
        code: "custom",
        path: ["blockingDecisionId"],
        message: "Failed integration requires a blocking decision",
      });
    }
  });

export const SupervisorWorkflowAcceptanceSchema = z.enum([
  "pending",
  "machine_verified",
  "user_accepted",
  "waived",
]);

const SupervisorWorkflowProgressSchema = z
  .object({
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    effectId: IdentifierSchema.optional(),
    blockingDecisionId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.status === "failed" && !progress.blockingDecisionId) {
      context.addIssue({
        code: "custom",
        path: ["blockingDecisionId"],
        message: "Failed workflow progress requires a blocking decision",
      });
    }
  });

export const SupervisorWorkflowCancellationSchema =
  SupervisorWorkflowProgressSchema.extend({
    pendingSessionIds: z.array(IdentifierSchema).max(4096),
    pendingWorkspaceIds: z.array(IdentifierSchema).max(4096),
  }).strict();

export const SupervisorWorkflowFinalizationSchema =
  SupervisorWorkflowProgressSchema;

export const SupervisorRunLimitsSchema = z
  .object({
    maxConcurrency: z
      .number()
      .int()
      .min(1)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxConcurrency),
    maxTasks: z.number().int().min(1).max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
    maxAttemptsPerTask: z
      .number()
      .int()
      .min(1)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxAttemptsPerTask),
    maxPlannerReplans: z
      .number()
      .int()
      .min(0)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxPlannerReplans),
  })
  .strict();

export const SupervisorRunPrioritySchema = z.enum([
  "urgent",
  "high",
  "normal",
  "low",
]);

export const SupervisorCapacityFailureKindSchema = z.enum([
  "quota_exhausted",
  "transient_rate_limit",
  "auth_required",
  "transport",
  "session_fatal",
  "unknown",
]);

export const SupervisorManagerTurnKindSchema = z.enum([
  "plan",
  "replan",
  "question",
  "continue",
  "complete",
]);

export const SupervisorExecutionEnvelopeSchema = z
  .object({
    goal: z.string().trim().min(1).max(32_000),
    fileScopes: z.array(RelativePathSchema).max(4096),
    verificationCommands: z.array(z.string().trim().min(1).max(4096)).max(128),
    successCriteria: z
      .array(z.string().trim().min(1).max(4000))
      .min(1)
      .max(128),
    permissionScopes: z.array(z.string().trim().min(1).max(2000)).max(128),
    destructiveActions: z.array(z.string().trim().min(1).max(2000)).max(32),
    delivery: z
      .object({
        createCommit: z.literal(true),
        targetBranch: z.string().trim().min(1).max(1024),
        targetHead: z.string().trim().min(1).max(1024),
        allowDefaultBranch: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const SupervisorApprovedPlanSchema = z
  .object({
    version: z.number().int().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().trim().min(1).max(8000),
    envelope: SupervisorExecutionEnvelopeSchema,
    approvedAt: TimestampSchema.optional(),
    approvedByUserId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (Boolean(plan.approvedAt) !== Boolean(plan.approvedByUserId)) {
      context.addIssue({
        code: "custom",
        path: ["approvedAt"],
        message: "Plan approval time and user must be persisted together",
      });
    }
  });

export const SupervisorManagerSessionSchema = z
  .object({
    agentId: IdentifierSchema,
    chatId: IdentifierSchema,
    agentSessionId: IdentifierSchema.optional(),
    status: z.enum([
      "creating",
      "running",
      "stopped",
      "waiting_capacity",
      "failed",
    ]),
    exactResumeRequired: z.literal(true),
    pendingTurnKind: z.enum(["plan", "replan"]).optional(),
    activeTurn: z
      .object({
        turnId: IdentifierSchema,
        kind: SupervisorManagerTurnKindSchema,
        startedAt: TimestampSchema,
      })
      .strict()
      .optional(),
    lastCompletedTurnId: IdentifierSchema.optional(),
    lastCheckedAt: TimestampSchema.optional(),
  })
  .strict();

export const SupervisorCapacityWaitSchema = z
  .object({
    waitId: IdentifierSchema,
    owner: z.enum(["manager", "task"]),
    taskId: IdentifierSchema.optional(),
    attemptId: IdentifierSchema.optional(),
    agentId: IdentifierSchema,
    capacityGroup: IdentifierSchema.optional(),
    kind: SupervisorCapacityFailureKindSchema,
    reason: z.string().trim().min(1).max(2000),
    suspendedAt: TimestampSchema,
    resetAt: TimestampSchema.optional(),
    retryAt: TimestampSchema,
    backoffStep: z.number().int().min(0).max(64),
  })
  .strict()
  .superRefine((wait, context) => {
    if (wait.owner === "task" && !(wait.taskId && wait.attemptId)) {
      context.addIssue({
        code: "custom",
        path: ["taskId"],
        message: "Task capacity waits require task and attempt ids",
      });
    }
    if (wait.owner === "manager" && (wait.taskId || wait.attemptId)) {
      context.addIssue({
        code: "custom",
        path: ["taskId"],
        message: "Manager capacity waits cannot reference a worker attempt",
      });
    }
  });

export const SupervisorManagerDecisionSchema = z
  .object({
    decisionId: IdentifierSchema,
    kind: z.enum([
      "plan_changes",
      "product_ambiguity",
      "scope_expansion",
      "permission",
      "dirty_overlap",
      "baseline_drift",
      "conflict",
      "exact_resume_failed",
      "classifier_uncertain",
      "budget_exhausted",
      "goal_criteria_acceptance",
      "goal_criterion_evidence",
    ]),
    status: z.enum(["open", "answered", "cancelled"]),
    prompt: z.string().trim().min(1).max(8000),
    opaqueTokenHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    answer: z.string().trim().min(1).max(8000).optional(),
    createdAt: TimestampSchema,
    answeredAt: TimestampSchema.optional(),
    answeredByUserId: IdentifierSchema.optional(),
    criterionIds: z.array(IdentifierSchema).min(1).max(128).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    const isGoalCriterionDecision =
      decision.kind === "goal_criteria_acceptance" ||
      decision.kind === "goal_criterion_evidence";
    if (isGoalCriterionDecision !== Boolean(decision.criterionIds)) {
      context.addIssue({
        code: "custom",
        path: ["criterionIds"],
        message:
          "Goal criterion decisions require criterion ids and other decisions cannot bind them",
      });
    }
  });

export const SupervisorGoalCriterionResolutionSchema = z
  .object({
    criterionId: IdentifierSchema,
    resolution: z.enum(["user_accepted", "waived"]),
    decisionId: IdentifierSchema,
    resolvedAt: TimestampSchema,
    resolvedByUserId: IdentifierSchema,
  })
  .strict();

export const SupervisorVerificationEvidenceSchema = z
  .object({
    command: z.string().trim().min(1).max(4096),
    exitCode: z.number().int().nullable(),
    outputSummary: z.string().max(8000),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema,
  })
  .strict();

export const SupervisorPatchArtifactSchema = z
  .object({
    artifactId: IdentifierSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    storageRef: z.string().trim().min(1).max(2048),
  })
  .strict();

export const SupervisorFileManifestSchema = z
  .object({
    touched: z.array(RelativePathSchema).max(4096),
    created: z.array(RelativePathSchema).max(4096),
    deleted: z.array(RelativePathSchema).max(4096),
    renamed: z
      .array(
        z
          .object({
            from: RelativePathSchema,
            to: RelativePathSchema,
          })
          .strict()
      )
      .max(4096),
  })
  .strict();

export const SupervisorWorkerResultSchema = z
  .object({
    semanticStatus: z.enum(["succeeded", "needs_user", "failed", "cancelled"]),
    reason: z.string().trim().min(1).max(4000),
    outcomeSummary: z.string().trim().min(1).max(8000),
    files: SupervisorFileManifestSchema,
    verification: z.array(SupervisorVerificationEvidenceSchema).max(64),
    patch: SupervisorPatchArtifactSchema.optional(),
    toolFailureSummary: z.array(z.string().trim().min(1).max(2000)).max(64),
    unresolvedPermissions: z.array(z.string().trim().min(1).max(2000)).max(64),
    agentId: IdentifierSchema,
    chatId: IdentifierSchema,
    agentSessionId: IdentifierSchema.optional(),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema,
  })
  .strict();

export const SupervisorWorkerAttemptSchema = z
  .object({
    attemptId: IdentifierSchema,
    chatId: IdentifierSchema,
    agentSessionId: IdentifierSchema.optional(),
    agentId: IdentifierSchema,
    modelId: z.string().trim().min(1).max(512).optional(),
    isolatedProjectRoot: z.string().trim().min(1).max(4096).optional(),
    workspace: z
      .object({
        workspaceId: IdentifierSchema,
        kind: z.enum(["read_only", "direct_git", "isolated_git"]),
        userProjectRoot: z.string().trim().min(1).max(4096),
        projectRoot: z.string().trim().min(1).max(4096),
        repositoryRoot: z.string().trim().min(1).max(4096).optional(),
        gitWorktreeRoot: z.string().trim().min(1).max(4096).optional(),
        baseHead: z.string().trim().min(1).max(1024).optional(),
        targetFingerprints: z.record(
          z.string(),
          z.string().regex(/^[a-f0-9]{64}$/)
        ),
      })
      .strict()
      .optional(),
    turnId: IdentifierSchema.optional(),
    status: z.enum([
      "starting",
      "running",
      "waiting_capacity",
      "uncertain",
      "terminal",
      "interrupted",
    ]),
    idempotencyKey: IdentifierSchema,
    dispatchEffectId: IdentifierSchema.optional(),
    promptHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    retryAt: TimestampSchema.optional(),
    uncertaintyId: IdentifierSchema.optional(),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema.optional(),
    result: SupervisorWorkerResultSchema.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const finished =
      attempt.status === "terminal" || attempt.status === "interrupted";
    if (finished && !attempt.finishedAt) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "Terminal and interrupted attempts require finishedAt",
      });
    }
    if (!finished && attempt.finishedAt) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "Active attempts cannot have finishedAt",
      });
    }
    if (attempt.result && attempt.status !== "terminal") {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Only terminal attempts can contain a result",
      });
    }
    if (attempt.status === "uncertain" && !attempt.uncertaintyId) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyId"],
        message: "Uncertain attempts require a durable uncertainty id",
      });
    }
    if (attempt.status !== "uncertain" && attempt.uncertaintyId) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyId"],
        message: "Only uncertain attempts may retain an uncertainty id",
      });
    }
  });

export const SupervisorGateRecordSchema = z
  .object({
    gateId: IdentifierSchema,
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema,
    kind: z.enum([
      "scope",
      "dirty_overlap",
      "baseline_drift",
      "deletion",
      "destructive_action",
      "verification",
      "conflict",
      "non_git_write",
    ]),
    status: z.enum(["pending", "approved", "rejected"]),
    reason: z.string().trim().min(1).max(4000),
    createdAt: TimestampSchema,
    decidedAt: TimestampSchema.optional(),
    decidedByUserId: IdentifierSchema.optional(),
  })
  .strict();

export const SupervisorRunAuditEntrySchema = z
  .object({
    auditId: IdentifierSchema,
    kind: z.enum([
      "run_created",
      "plan_accepted",
      "plan_rejected",
      "run_status_changed",
      "task_status_changed",
      "worker_bound",
      "worker_interrupted",
      "worker_result_recorded",
      "gate_recorded",
      "gate_decided",
      "recovery_reconciled",
      "final_verification_recorded",
      "migration_needs_user",
      "plan_awaiting_approval",
      "plan_approved",
      "plan_changes_requested",
      "manager_session_bound",
      "capacity_suspended",
      "capacity_resumed",
      "decision_opened",
      "decision_answered",
      "final_commit_created",
    ]),
    createdAt: TimestampSchema,
    actor: z.enum(["user", "orchestrator", "worker", "system"]),
    summary: z.string().trim().min(1).max(2000),
    taskId: IdentifierSchema.optional(),
    attemptId: IdentifierSchema.optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()])
      )
      .optional(),
  })
  .strict();

export const SupervisorTaskRecordSchema = z
  .object({
    taskId: IdentifierSchema,
    title: z.string().trim().min(1).max(240),
    goal: z.string().trim().min(1).max(8000),
    role: SupervisorTaskRoleSchema,
    executionMode: SupervisorTaskExecutionModeSchema,
    dependencies: z
      .array(IdentifierSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
    criterionIds: z.array(IdentifierSchema).max(128).default([]),
    changeKinds: z.array(SupervisorTaskChangeKindSchema).max(4).default([]),
    filesAllowed: z.array(RelativePathSchema).max(4096),
    verificationCommands: z.array(z.string().trim().min(1).max(4096)).max(64),
    preferredAgentId: IdentifierSchema.optional(),
    preferredModelId: z.string().trim().min(1).max(512).optional(),
    outcome: SupervisorRunOutcomeSchema.optional(),
    notBefore: TimestampSchema.optional(),
    activeAttemptId: IdentifierSchema.optional(),
    blockingDecisionId: IdentifierSchema.optional(),
    activity: SupervisorTaskActivitySchema.optional(),
    dispatch: SupervisorWorkflowDispatchSchema.optional(),
    capacityLease: SupervisorWorkflowCapacityLeaseSchema.optional(),
    verification: SupervisorWorkflowVerificationSchema.optional(),
    integration: SupervisorWorkflowIntegrationSchema.optional(),
    acceptance: SupervisorWorkflowAcceptanceSchema.optional(),
    status: SupervisorTaskStatusSchema,
    attempts: z
      .array(SupervisorWorkerAttemptSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxAttemptsPerTask),
  })
  .strict();

const SupervisorRunStateV3Schema = z
  .object({
    schemaVersion: z.literal(SUPERVISOR_RUN_SCHEMA_VERSION),
    runId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    userId: IdentifierSchema,
    projectId: IdentifierSchema.optional(),
    projectRoot: z.string().trim().min(1).max(4096),
    sourceGoalContract: z
      .object({
        intakeId: IdentifierSchema,
        revisionId: IdentifierSchema,
        revision: z.number().int().min(1).optional(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        createdAt: TimestampSchema.optional(),
        contract: SupervisorGoalContractSnapshotSchema.optional(),
      })
      .strict()
      .optional(),
    originatingChatId: IdentifierSchema.optional(),
    legacyAutomation: z
      .object({
        scheduleId: IdentifierSchema.optional(),
        providerId: IdentifierSchema.optional(),
        workerModelId: z.string().trim().min(1).max(512).optional(),
      })
      .strict()
      .optional(),
    agentAllowlist: z.array(IdentifierSchema).max(32).optional(),
    originalIntent: z.string().trim().min(1).max(32_000),
    constraints: z.array(z.string().trim().min(1).max(4000)).max(128),
    priority: SupervisorRunPrioritySchema,
    desiredState: SupervisorRunDesiredStateSchema,
    phase: SupervisorRunPhaseSchema,
    outcome: SupervisorRunOutcomeSchema.optional(),
    blockingDecisionId: IdentifierSchema.optional(),
    activity: SupervisorRunActivitySchema.optional(),
    workflowPlan: SupervisorWorkflowPlanSchema.optional(),
    workflowFinalVerification: SupervisorWorkflowVerificationSchema.optional(),
    cancellation: SupervisorWorkflowCancellationSchema.optional(),
    finalization: SupervisorWorkflowFinalizationSchema.optional(),
    status: SupervisorRunStatusSchema,
    managerSession: SupervisorManagerSessionSchema.optional(),
    plan: SupervisorApprovedPlanSchema.optional(),
    capacityWaits: z.array(SupervisorCapacityWaitSchema).max(1024),
    decisions: z.array(SupervisorManagerDecisionSchema).max(4096),
    goalCriterionResolutions: z
      .array(SupervisorGoalCriterionResolutionSchema)
      .max(128)
      .default([]),
    baseSnapshot: z
      .object({
        head: z.string().trim().min(1).max(1024).optional(),
        branch: z.string().trim().min(1).max(1024).optional(),
        dirtyPaths: z.array(RelativePathSchema).max(4096),
        targetFingerprints: z
          .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
          .default({}),
        capturedAt: TimestampSchema,
      })
      .strict(),
    deliveryFingerprints: z
      .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
      .default({}),
    limits: SupervisorRunLimitsSchema,
    tasks: z
      .array(SupervisorTaskRecordSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
    gates: z.array(SupervisorGateRecordSchema).max(4096),
    audit: z.array(SupervisorRunAuditEntrySchema).max(20_000),
    processedEventIds: z.array(IdentifierSchema).max(20_000),
    plannerReplanCount: z.number().int().nonnegative(),
    finalVerification: z.array(SupervisorVerificationEvidenceSchema).max(64),
    finalCommitSha: z.string().trim().min(1).max(1024).optional(),
    migratedFromVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if ((run.phase === "finished") !== Boolean(run.outcome)) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "Finished runs require an outcome and active runs cannot have one",
      });
    }
    if (run.tasks.length > run.limits.maxTasks) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Task count exceeds run maxTasks",
      });
    }
    if (run.plannerReplanCount > run.limits.maxPlannerReplans) {
      context.addIssue({
        code: "custom",
        path: ["plannerReplanCount"],
        message: "Planner replan count exceeds run limit",
      });
    }
    if (run.status === "awaiting_approval" && !run.plan) {
      context.addIssue({
        code: "custom",
        path: ["plan"],
        message: "Awaiting approval requires a persisted plan",
      });
    }
    if (run.finalCommitSha && run.outcome !== "succeeded") {
      context.addIssue({
        code: "custom",
        path: ["finalCommitSha"],
        message: "Only succeeded runs may contain a final commit SHA",
      });
    }

    const hasActiveWorkerAttempt = validateSupervisorTasks(
      run.tasks,
      run.limits.maxAttemptsPerTask,
      context
    );
    if (run.outcome && hasActiveWorkerAttempt) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Terminal run outcomes cannot retain active worker attempts",
      });
    }

    validateDependencyGraph(run.tasks, context);
    validateUniqueBindings(run.tasks, context);
    validateGoalContractFacts(run, context);
    validateBlockingDecisionReferences(
      run.decisions,
      [
        { id: run.blockingDecisionId, path: ["blockingDecisionId"] },
        {
          id: run.workflowPlan?.blockingDecisionId,
          path: ["workflowPlan", "blockingDecisionId"],
        },
        {
          id: run.workflowFinalVerification?.blockingDecisionId,
          path: ["workflowFinalVerification", "blockingDecisionId"],
        },
        {
          id: run.cancellation?.blockingDecisionId,
          path: ["cancellation", "blockingDecisionId"],
        },
        {
          id: run.finalization?.blockingDecisionId,
          path: ["finalization", "blockingDecisionId"],
        },
        ...run.tasks.flatMap((task, taskIndex) => [
          {
            id: task.blockingDecisionId,
            path: ["tasks", taskIndex, "blockingDecisionId"],
          },
          {
            id: task.verification?.blockingDecisionId,
            path: ["tasks", taskIndex, "verification", "blockingDecisionId"],
          },
          {
            id: task.integration?.blockingDecisionId,
            path: ["tasks", taskIndex, "integration", "blockingDecisionId"],
          },
        ]),
      ],
      context
    );
  });

type SupervisorTaskRecordInput = z.infer<typeof SupervisorTaskRecordSchema>;

function validateSupervisorTasks(
  tasks: SupervisorTaskRecordInput[],
  maxAttemptsPerTask: number,
  context: z.RefinementCtx
): boolean {
  const taskIds = new Set<string>();
  let hasActiveWorkerAttempt = false;
  for (const [taskIndex, task] of tasks.entries()) {
    if (taskIds.has(task.taskId)) {
      context.addIssue({
        code: "custom",
        path: ["tasks", taskIndex, "taskId"],
        message: `Duplicate task id: ${task.taskId}`,
      });
    }
    taskIds.add(task.taskId);
    if (task.attempts.length > maxAttemptsPerTask) {
      context.addIssue({
        code: "custom",
        path: ["tasks", taskIndex, "attempts"],
        message: "Attempt count exceeds task limit",
      });
    }
    const activeAttempts = task.attempts.filter((attempt) =>
      isActiveSupervisorAttemptStatus(attempt.status)
    );
    hasActiveWorkerAttempt ||= activeAttempts.length > 0;
    validateTaskAttemptFacts(task, taskIndex, activeAttempts, context);
    validateWorkflowTaskFacts(task, taskIndex, context);
  }
  return hasActiveWorkerAttempt;
}

function validateTaskAttemptFacts(
  task: SupervisorTaskRecordInput,
  taskIndex: number,
  activeAttempts: SupervisorTaskRecordInput["attempts"],
  context: z.RefinementCtx
): void {
  if (activeAttempts.length > 1) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "activeAttemptId"],
      message: "A task cannot have more than one active attempt",
    });
  }
  if (task.activeAttemptId !== activeAttempts[0]?.attemptId) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "activeAttemptId"],
      message: "activeAttemptId must reference the sole active attempt",
    });
  }
  if (task.outcome && activeAttempts.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "outcome"],
      message: "Terminal task outcomes cannot retain an active attempt",
    });
  }
}

function validateWorkflowTaskFacts(
  task: SupervisorTaskRecordInput,
  taskIndex: number,
  context: z.RefinementCtx
): void {
  if (
    (task.dispatch?.state === "leased" ||
      task.dispatch?.state === "start_requested") &&
    !task.capacityLease
  ) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "capacityLease"],
      message: "Leased and start-requested dispatches require a lease",
    });
  }
  if (
    task.outcome === "succeeded" &&
    task.integration &&
    task.integration.status !== "succeeded" &&
    task.integration.status !== "not_required"
  ) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "integration"],
      message: "Successful work cannot retain incomplete integration",
    });
  }
  if (task.outcome === "succeeded" && task.acceptance === "pending") {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "acceptance"],
      message: "Successful work requires explicit acceptance",
    });
  }
  if (
    task.acceptance === "machine_verified" &&
    !(
      task.verification &&
      (task.verification.status === "passed" ||
        task.verification.status === "accepted") &&
      task.verification.evidenceRefs.length > 0
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["tasks", taskIndex, "verification"],
      message: "Machine acceptance requires passed evidence",
    });
  }
}

function validateBlockingDecisionReferences(
  decisions: z.infer<typeof SupervisorManagerDecisionSchema>[],
  references: Array<{ id: string | undefined; path: PropertyKey[] }>,
  context: z.RefinementCtx
): void {
  const openDecisionIds = new Set(
    decisions
      .filter((decision) => decision.status === "open")
      .map((decision) => decision.decisionId)
  );
  for (const reference of references) {
    if (reference.id && !openDecisionIds.has(reference.id)) {
      context.addIssue({
        code: "custom",
        path: reference.path,
        message: "Blocking decision must reference an open durable decision",
      });
    }
  }
}

function validateGoalContractFacts(
  run: z.infer<typeof SupervisorRunStateV3Schema>,
  context: z.RefinementCtx
): void {
  const contract = run.sourceGoalContract?.contract;
  if (!contract) {
    if (run.outcome === "succeeded" && run.sourceGoalContract) {
      context.addIssue({
        code: "custom",
        path: ["sourceGoalContract", "contract"],
        message:
          "A run sourced from Goal Intake cannot succeed without its frozen typed contract",
      });
    }
    return;
  }
  if (contract.unresolvedQuestions.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["sourceGoalContract", "contract", "unresolvedQuestions"],
      message: "Approved Goal Contracts cannot retain unresolved questions",
    });
  }

  const criteriaById = new Map(
    contract.acceptanceCriteria.map((criterion) => [
      criterion.criterionId,
      criterion,
    ])
  );
  validateGoalCriterionCoverage(run, contract, criteriaById, context);
  validateGoalCriterionResolutions(run, criteriaById, context);

  if (run.outcome !== "succeeded") {
    return;
  }
  const assessment = assessGoalContractCriteria(run);
  if (assessment.pendingMachineCriterionIds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: `Successful Goal run is missing machine evidence for: ${assessment.pendingMachineCriterionIds.join(", ")}`,
    });
  }
  if (assessment.pendingUserCriterionIds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: `Successful Goal run is missing explicit user acceptance for: ${assessment.pendingUserCriterionIds.join(", ")}`,
    });
  }
}

function validateGoalCriterionCoverage(
  run: z.infer<typeof SupervisorRunStateV3Schema>,
  contract: z.infer<typeof SupervisorGoalContractSnapshotSchema>,
  criteriaById: Map<
    string,
    z.infer<
      typeof SupervisorGoalContractSnapshotSchema
    >["acceptanceCriteria"][number]
  >,
  context: z.RefinementCtx
): void {
  const coveredCriterionIds = new Set<string>();
  for (const [taskIndex, task] of run.tasks.entries()) {
    for (const [criterionIndex, criterionId] of task.criterionIds.entries()) {
      if (!criteriaById.has(criterionId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "criterionIds", criterionIndex],
          message: `Task references unknown Goal Contract criterion ${criterionId}`,
        });
      }
      coveredCriterionIds.add(criterionId);
    }
  }
  if (run.tasks.length > 0) {
    for (const criterion of contract.acceptanceCriteria) {
      if (!coveredCriterionIds.has(criterion.criterionId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks"],
          message: `Goal Contract criterion ${criterion.criterionId} is not covered by any work item`,
        });
      }
    }
  }
}

function validateGoalCriterionResolutions(
  run: z.infer<typeof SupervisorRunStateV3Schema>,
  criteriaById: Map<
    string,
    z.infer<
      typeof SupervisorGoalContractSnapshotSchema
    >["acceptanceCriteria"][number]
  >,
  context: z.RefinementCtx
): void {
  const resolutionsByCriterionId = new Map<string, number>();
  for (const [
    resolutionIndex,
    resolution,
  ] of run.goalCriterionResolutions.entries()) {
    const criterion = criteriaById.get(resolution.criterionId);
    if (!criterion || criterion.evidence !== "user") {
      context.addIssue({
        code: "custom",
        path: ["goalCriterionResolutions", resolutionIndex, "criterionId"],
        message:
          "Only user-evidence Goal Contract criteria can have an explicit user resolution",
      });
    }
    if (resolutionsByCriterionId.has(resolution.criterionId)) {
      context.addIssue({
        code: "custom",
        path: ["goalCriterionResolutions", resolutionIndex, "criterionId"],
        message: `Goal Contract criterion ${resolution.criterionId} has more than one resolution`,
      });
    }
    resolutionsByCriterionId.set(resolution.criterionId, resolutionIndex);
    const decision = run.decisions.find(
      (candidate) => candidate.decisionId === resolution.decisionId
    );
    if (
      !decision ||
      decision.kind !== "goal_criteria_acceptance" ||
      decision.status !== "answered" ||
      decision.answeredAt !== resolution.resolvedAt ||
      decision.answeredByUserId !== resolution.resolvedByUserId ||
      !decision.criterionIds?.includes(resolution.criterionId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["goalCriterionResolutions", resolutionIndex, "decisionId"],
        message:
          "User criterion resolutions must reference the exact answered durable acceptance decision",
      });
    }
  }
}

export const SupervisorRunStateSchema = z.preprocess(
  (value) =>
    isSupervisorRunDocumentVersion(value, 2)
      ? upgradeSupervisorRunV2Document(value)
      : value,
  SupervisorRunStateV3Schema
);

export function isActiveSupervisorAttemptStatus(status: string): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_capacity" ||
    status === "uncertain"
  );
}

export function upgradeSupervisorRunV2Document(
  value: Record<string, unknown>
): Record<string, unknown> {
  const status = typeof value.status === "string" ? value.status : "planning";
  const capacityWaits = Array.isArray(value.capacityWaits)
    ? value.capacityWaits
    : [];
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  const recoveringInterruptedCancellation =
    status === "cancelled" && rawTasks.some(hasLegacyActiveAttempt);
  const tasks = rawTasks.map((task) =>
    upgradeSupervisorTaskV2Document(
      task,
      capacityWaits,
      recoveringInterruptedCancellation
    )
  );
  const phase =
    typeof value.phase === "string"
      ? value.phase
      : inferLegacyRunPhase(status, value, tasks);
  const outcome =
    typeof value.outcome === "string"
      ? value.outcome
      : legacyRunOutcome(status);
  let blockingDecisionId =
    typeof value.blockingDecisionId === "string"
      ? value.blockingDecisionId
      : undefined;
  if (!blockingDecisionId && status === "needs_user") {
    blockingDecisionId =
      findOpenDecisionId(value.decisions) ?? "compat-run-needs-user";
  }
  const activity =
    typeof value.activity === "string"
      ? value.activity
      : legacyRunActivity(status, phase);

  const decisions = Array.isArray(value.decisions) ? [...value.decisions] : [];
  let decisionTimestamp = "1970-01-01T00:00:00.000Z";
  if (typeof value.updatedAt === "string") {
    decisionTimestamp = value.updatedAt;
  } else if (typeof value.createdAt === "string") {
    decisionTimestamp = value.createdAt;
  }
  if (blockingDecisionId) {
    ensureUpgradedDecision(
      decisions,
      blockingDecisionId,
      "Legacy Supervisor run requires user input",
      decisionTimestamp
    );
  }
  for (const task of tasks) {
    if (typeof task.blockingDecisionId === "string") {
      ensureUpgradedDecision(
        decisions,
        task.blockingDecisionId,
        `Legacy Supervisor task ${String(task.taskId)} requires user input`,
        decisionTimestamp
      );
    }
  }

  const upgraded: Record<string, unknown> = {
    ...value,
    schemaVersion: SUPERVISOR_RUN_SCHEMA_VERSION,
    desiredState:
      typeof value.desiredState === "string"
        ? value.desiredState
        : legacyRunDesiredState(status),
    phase,
    ...(outcome ? { outcome } : {}),
    ...(blockingDecisionId ? { blockingDecisionId } : {}),
    ...(activity ? { activity } : {}),
    decisions,
    tasks,
  };
  if (recoveringInterruptedCancellation) {
    upgraded.status = "paused";
    upgraded.desiredState = "cancelled";
    upgraded.phase = "executing";
    upgraded.activity = "executing";
    Reflect.deleteProperty(upgraded, "outcome");
  }
  return upgraded;
}

function isSupervisorRunDocumentVersion(
  value: unknown,
  version: number
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === version
  );
}

function upgradeSupervisorTaskV2Document(
  value: unknown,
  capacityWaits: unknown[],
  recoveringInterruptedCancellation: boolean
): Record<string, unknown> {
  const task =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const status = typeof task.status === "string" ? task.status : "blocked";
  const attempts = Array.isArray(task.attempts) ? task.attempts : [];
  const activeAttempts = findLegacyActiveAttempts(attempts);
  const activeAttemptId = inferLegacyActiveAttemptId(task, activeAttempts);
  const recoveringActiveAttempt =
    recoveringInterruptedCancellation && activeAttempts.length > 0;
  const outcome = inferUpgradedTaskOutcome(
    task,
    status,
    recoveringActiveAttempt
  );
  let blockingDecisionId =
    typeof task.blockingDecisionId === "string"
      ? task.blockingDecisionId
      : undefined;
  if (!blockingDecisionId && status === "needs_user") {
    blockingDecisionId = `${COMPAT_TASK_BLOCKER_ID_PREFIX}:${String(
      task.taskId ?? "unknown"
    )}`;
  }
  const activity = inferUpgradedTaskActivity(
    task,
    status,
    activeAttempts,
    recoveringActiveAttempt
  );
  let notBefore =
    typeof task.notBefore === "string" ? task.notBefore : undefined;
  if (!notBefore && status === "waiting_capacity") {
    notBefore = findTaskRetryAt(capacityWaits, task.taskId);
  }

  const upgraded: Record<string, unknown> = {
    ...task,
    ...(outcome ? { outcome } : {}),
    ...(notBefore ? { notBefore } : {}),
    ...(activeAttemptId ? { activeAttemptId } : {}),
    ...(blockingDecisionId ? { blockingDecisionId } : {}),
    ...(activity ? { activity } : {}),
  };
  if (recoveringActiveAttempt) {
    upgraded.status = recoveredLegacyTaskStatus(activeAttempts);
    Reflect.deleteProperty(upgraded, "outcome");
  }
  return upgraded;
}

const COMPAT_TASK_BLOCKER_ID_PREFIX = "compat-task-needs-user";

function ensureUpgradedDecision(
  decisions: unknown[],
  decisionId: string,
  prompt: string,
  createdAt: string
): void {
  if (
    decisions.some(
      (decision) =>
        typeof decision === "object" &&
        decision !== null &&
        "decisionId" in decision &&
        decision.decisionId === decisionId
    )
  ) {
    return;
  }
  decisions.push({
    decisionId,
    kind: "product_ambiguity",
    status: "open",
    prompt,
    createdAt,
  });
}

function findLegacyActiveAttempts(
  attempts: unknown[]
): Record<string, unknown>[] {
  return attempts.filter(
    (attempt) =>
      typeof attempt === "object" &&
      attempt !== null &&
      "status" in attempt &&
      typeof attempt.status === "string" &&
      isActiveSupervisorAttemptStatus(attempt.status)
  ) as Record<string, unknown>[];
}

function inferLegacyActiveAttemptId(
  task: Record<string, unknown>,
  activeAttempts: Record<string, unknown>[]
): string | undefined {
  if (typeof task.activeAttemptId === "string") {
    return task.activeAttemptId;
  }
  const soleAttemptId = activeAttempts[0]?.attemptId;
  return activeAttempts.length === 1 && typeof soleAttemptId === "string"
    ? soleAttemptId
    : undefined;
}

function inferUpgradedTaskOutcome(
  task: Record<string, unknown>,
  status: string,
  recoveringActiveAttempt: boolean
): unknown {
  if (recoveringActiveAttempt) {
    return undefined;
  }
  return typeof task.outcome === "string"
    ? task.outcome
    : legacyTaskOutcome(status);
}

function inferUpgradedTaskActivity(
  task: Record<string, unknown>,
  status: string,
  activeAttempts: Record<string, unknown>[],
  recoveringActiveAttempt: boolean
): unknown {
  if (recoveringActiveAttempt) {
    return activeAttempts[0]?.status === "waiting_capacity"
      ? "capacity_wait"
      : "agent_turn";
  }
  return typeof task.activity === "string"
    ? task.activity
    : legacyTaskActivity(status);
}

function recoveredLegacyTaskStatus(
  activeAttempts: Record<string, unknown>[]
): string {
  return activeAttempts[0]?.status === "waiting_capacity"
    ? "waiting_capacity"
    : "running";
}

function hasLegacyActiveAttempt(value: unknown): boolean {
  if (!(typeof value === "object" && value !== null && "attempts" in value)) {
    return false;
  }
  return (
    Array.isArray(value.attempts) &&
    value.attempts.some(
      (attempt) =>
        typeof attempt === "object" &&
        attempt !== null &&
        "status" in attempt &&
        typeof attempt.status === "string" &&
        isActiveSupervisorAttemptStatus(attempt.status)
    )
  );
}

function legacyRunDesiredState(status: string): string {
  if (status === "paused") {
    return "paused";
  }
  return status === "cancelled" ? "cancelled" : "running";
}

function inferLegacyRunPhase(
  status: string,
  run: Record<string, unknown>,
  tasks: Record<string, unknown>[]
): string {
  if (
    status === "draft" ||
    status === "planning" ||
    status === "awaiting_approval"
  ) {
    return "planning";
  }
  if (status === "completing") {
    return "finalizing";
  }
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return "finished";
  }
  if (status === "waiting_capacity") {
    const waits = Array.isArray(run.capacityWaits) ? run.capacityWaits : [];
    return waits.some(
      (wait) =>
        typeof wait === "object" &&
        wait !== null &&
        "owner" in wait &&
        wait.owner === "task"
    )
      ? "executing"
      : "planning";
  }
  if (status === "needs_user") {
    const finalVerification = Array.isArray(run.finalVerification)
      ? run.finalVerification
      : [];
    if (
      finalVerification.length > 0 ||
      (tasks.length > 0 && tasks.every((task) => task.status === "completed"))
    ) {
      return "finalizing";
    }
    return run.plan || tasks.length > 0 ? "executing" : "planning";
  }
  return "executing";
}

function legacyRunOutcome(status: string): string | undefined {
  if (status === "completed") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  return status === "cancelled" ? "cancelled" : undefined;
}

function legacyRunActivity(status: string, phase: string): string | undefined {
  if (status === "planning") {
    return "planning";
  }
  if (status === "queued") {
    return "dispatching";
  }
  if (status === "running") {
    return "executing";
  }
  if (status === "waiting_capacity") {
    return "capacity_wait";
  }
  if (status === "paused") {
    return "dispatching";
  }
  if (status === "needs_user") {
    if (phase === "planning") {
      return "planning";
    }
    return phase === "finalizing" ? "finalizing" : "executing";
  }
  return status === "completing" ? "finalizing" : undefined;
}

function legacyTaskOutcome(status: string): string | undefined {
  if (status === "completed") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  return status === "cancelled" ? "cancelled" : undefined;
}

function legacyTaskActivity(status: string): string | undefined {
  switch (status) {
    case "queued":
      return "dispatching";
    case "running":
      return "agent_turn";
    case "waiting_capacity":
      return "capacity_wait";
    case "reviewing":
      return "verification";
    case "integrating":
      return "integration";
    default:
      return undefined;
  }
}

function findOpenDecisionId(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const decision = value.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "status" in candidate &&
      candidate.status === "open" &&
      "decisionId" in candidate &&
      typeof candidate.decisionId === "string"
  ) as Record<string, unknown> | undefined;
  return typeof decision?.decisionId === "string"
    ? decision.decisionId
    : undefined;
}

function findTaskRetryAt(
  waits: unknown[],
  taskId: unknown
): string | undefined {
  const wait = waits.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "taskId" in candidate &&
      candidate.taskId === taskId &&
      "retryAt" in candidate &&
      typeof candidate.retryAt === "string"
  ) as Record<string, unknown> | undefined;
  return typeof wait?.retryAt === "string" ? wait.retryAt : undefined;
}

function validateDependencyGraph(
  tasks: z.infer<typeof SupervisorTaskRecordSchema>[],
  context: z.RefinementCtx
): void {
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  for (const [taskIndex, task] of tasks.entries()) {
    const seenDependencies = new Set<string>();
    for (const [dependencyIndex, dependency] of task.dependencies.entries()) {
      if (!taskIds.has(dependency)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "dependencies", dependencyIndex],
          message: `Unknown task dependency: ${dependency}`,
        });
      }
      if (dependency === task.taskId) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "dependencies", dependencyIndex],
          message: "Tasks cannot depend on themselves",
        });
      }
      if (seenDependencies.has(dependency)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "dependencies", dependencyIndex],
          message: `Duplicate task dependency: ${dependency}`,
        });
      }
      seenDependencies.add(dependency);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (taskId: string, depth: number): void => {
    if (depth > SUPERVISOR_MAX_DEPENDENCY_DEPTH) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `Dependency depth exceeds ${SUPERVISOR_MAX_DEPENDENCY_DEPTH}`,
      });
      return;
    }
    if (visiting.has(taskId)) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: `Task dependency cycle detected at ${taskId}`,
      });
      return;
    }
    if (visited.has(taskId)) {
      return;
    }
    visiting.add(taskId);
    for (const dependency of byId.get(taskId)?.dependencies ?? []) {
      if (byId.has(dependency)) {
        visit(dependency, depth + 1);
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) {
    visit(task.taskId, 1);
  }
}

function validateUniqueBindings(
  tasks: z.infer<typeof SupervisorTaskRecordSchema>[],
  context: z.RefinementCtx
): void {
  const attemptIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const [taskIndex, task] of tasks.entries()) {
    for (const [attemptIndex, attempt] of task.attempts.entries()) {
      if (attemptIds.has(attempt.attemptId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "attempts", attemptIndex, "attemptId"],
          message: `Duplicate attempt id: ${attempt.attemptId}`,
        });
      }
      attemptIds.add(attempt.attemptId);
      if (idempotencyKeys.has(attempt.idempotencyKey)) {
        context.addIssue({
          code: "custom",
          path: [
            "tasks",
            taskIndex,
            "attempts",
            attemptIndex,
            "idempotencyKey",
          ],
          message: `Duplicate idempotency key: ${attempt.idempotencyKey}`,
        });
      }
      idempotencyKeys.add(attempt.idempotencyKey);
    }
  }
}

export type SupervisorRunStatus = z.infer<typeof SupervisorRunStatusSchema>;
export type SupervisorTaskStatus = z.infer<typeof SupervisorTaskStatusSchema>;
export type SupervisorRunDesiredState = z.infer<
  typeof SupervisorRunDesiredStateSchema
>;
export type SupervisorRunPhase = z.infer<typeof SupervisorRunPhaseSchema>;
export type SupervisorRunOutcome = z.infer<typeof SupervisorRunOutcomeSchema>;
export type SupervisorRunActivity = z.infer<typeof SupervisorRunActivitySchema>;
export type SupervisorGoalContractSnapshot = z.infer<
  typeof SupervisorGoalContractSnapshotSchema
>;
export type SupervisorGoalAuthorityPolicy = z.infer<
  typeof SupervisorGoalAuthorityPolicySchema
>;
export type SupervisorTaskChangeKind = z.infer<
  typeof SupervisorTaskChangeKindSchema
>;
export type SupervisorTaskActivity = z.infer<
  typeof SupervisorTaskActivitySchema
>;
export type SupervisorWorkflowPlan = z.infer<
  typeof SupervisorWorkflowPlanSchema
>;
export type SupervisorWorkflowVerification = z.infer<
  typeof SupervisorWorkflowVerificationSchema
>;
export type SupervisorWorkflowDispatch = z.infer<
  typeof SupervisorWorkflowDispatchSchema
>;
export type SupervisorWorkflowCapacityLease = z.infer<
  typeof SupervisorWorkflowCapacityLeaseSchema
>;
export type SupervisorWorkflowIntegration = z.infer<
  typeof SupervisorWorkflowIntegrationSchema
>;
export type SupervisorWorkflowAcceptance = z.infer<
  typeof SupervisorWorkflowAcceptanceSchema
>;
export type SupervisorWorkflowCancellation = z.infer<
  typeof SupervisorWorkflowCancellationSchema
>;
export type SupervisorWorkflowFinalization = z.infer<
  typeof SupervisorWorkflowFinalizationSchema
>;
export type SupervisorRunPriority = z.infer<typeof SupervisorRunPrioritySchema>;
export type SupervisorCapacityFailureKind = z.infer<
  typeof SupervisorCapacityFailureKindSchema
>;
export type SupervisorExecutionEnvelope = z.infer<
  typeof SupervisorExecutionEnvelopeSchema
>;
export type SupervisorApprovedPlan = z.infer<
  typeof SupervisorApprovedPlanSchema
>;
export type SupervisorManagerSession = z.infer<
  typeof SupervisorManagerSessionSchema
>;
export type SupervisorCapacityWait = z.infer<
  typeof SupervisorCapacityWaitSchema
>;
export type SupervisorManagerDecision = z.infer<
  typeof SupervisorManagerDecisionSchema
>;
export type SupervisorGoalCriterionResolution = z.infer<
  typeof SupervisorGoalCriterionResolutionSchema
>;
export type SupervisorRunLimits = z.infer<typeof SupervisorRunLimitsSchema>;
export type SupervisorWorkerResult = z.infer<
  typeof SupervisorWorkerResultSchema
>;
export type SupervisorFileManifest = z.infer<
  typeof SupervisorFileManifestSchema
>;
export type SupervisorPatchArtifact = z.infer<
  typeof SupervisorPatchArtifactSchema
>;
export type SupervisorVerificationEvidence = z.infer<
  typeof SupervisorVerificationEvidenceSchema
>;
export type SupervisorWorkerAttempt = z.infer<
  typeof SupervisorWorkerAttemptSchema
>;
export type SupervisorTaskRecord = z.infer<typeof SupervisorTaskRecordSchema>;
export type SupervisorRunState = z.infer<typeof SupervisorRunStateSchema>;
export type SupervisorRunAuditEntry = z.infer<
  typeof SupervisorRunAuditEntrySchema
>;
export type SupervisorGateRecord = z.infer<typeof SupervisorGateRecordSchema>;

export interface SupervisorGoalCriterionAssessment {
  satisfiedMachineCriterionIds: string[];
  resolvedUserCriterionIds: string[];
  pendingMachineCriterionIds: string[];
  pendingUserCriterionIds: string[];
}

export function assessGoalContractCriteria(
  run: Pick<
    SupervisorRunState,
    "sourceGoalContract" | "tasks" | "goalCriterionResolutions"
  >
): SupervisorGoalCriterionAssessment {
  const contract = run.sourceGoalContract?.contract;
  if (!contract) {
    return {
      satisfiedMachineCriterionIds: [],
      resolvedUserCriterionIds: [],
      pendingMachineCriterionIds: run.sourceGoalContract
        ? ["typed-contract-missing"]
        : [],
      pendingUserCriterionIds: [],
    };
  }
  const resolvedUserCriterionIds = new Set(
    run.goalCriterionResolutions.map((resolution) => resolution.criterionId)
  );
  const satisfiedMachineCriterionIds = new Set<string>();
  for (const criterion of contract.acceptanceCriteria) {
    if (criterion.evidence !== "machine") {
      continue;
    }
    if (
      run.tasks.some(
        (task) =>
          task.criterionIds.includes(criterion.criterionId) &&
          contract.trustedVerificationCommands.length > 0 &&
          contract.trustedVerificationCommands.every((command) =>
            task.verificationCommands.includes(command)
          ) &&
          task.outcome === "succeeded" &&
          task.acceptance === "machine_verified" &&
          (task.verification?.status === "passed" ||
            task.verification?.status === "accepted") &&
          task.verification.evidenceRefs.length > 0
      )
    ) {
      satisfiedMachineCriterionIds.add(criterion.criterionId);
    }
  }
  return {
    satisfiedMachineCriterionIds: [...satisfiedMachineCriterionIds],
    resolvedUserCriterionIds: [...resolvedUserCriterionIds],
    pendingMachineCriterionIds: contract.acceptanceCriteria
      .filter(
        (criterion) =>
          criterion.evidence === "machine" &&
          !satisfiedMachineCriterionIds.has(criterion.criterionId)
      )
      .map((criterion) => criterion.criterionId),
    pendingUserCriterionIds: contract.acceptanceCriteria
      .filter(
        (criterion) =>
          criterion.evidence === "user" &&
          !resolvedUserCriterionIds.has(criterion.criterionId)
      )
      .map((criterion) => criterion.criterionId),
  };
}

export function goalContractCriteriaAreSatisfied(
  run: Pick<
    SupervisorRunState,
    "sourceGoalContract" | "tasks" | "goalCriterionResolutions"
  >
): boolean {
  const assessment = assessGoalContractCriteria(run);
  return (
    assessment.pendingMachineCriterionIds.length === 0 &&
    assessment.pendingUserCriterionIds.length === 0
  );
}

export function createDefaultSupervisorRunLimits(): SupervisorRunLimits {
  return { ...SUPERVISOR_RUN_LIMIT_DEFAULTS };
}
