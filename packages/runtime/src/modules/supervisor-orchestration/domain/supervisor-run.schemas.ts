import { z } from "zod";

export const SUPERVISOR_RUN_SCHEMA_VERSION = 2 as const;
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
    isolatedProjectRoot: z.string().trim().min(1).max(4096).optional(),
    workspace: z
      .object({
        workspaceId: IdentifierSchema,
        kind: z.enum(["read_only", "isolated_git"]),
        userProjectRoot: z.string().trim().min(1).max(4096),
        projectRoot: z.string().trim().min(1).max(4096),
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
      "terminal",
      "interrupted",
    ]),
    idempotencyKey: IdentifierSchema,
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
    filesAllowed: z.array(RelativePathSchema).max(4096),
    verificationCommands: z.array(z.string().trim().min(1).max(4096)).max(64),
    preferredAgentId: IdentifierSchema.optional(),
    status: SupervisorTaskStatusSchema,
    attempts: z
      .array(SupervisorWorkerAttemptSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxAttemptsPerTask),
  })
  .strict();

export const SupervisorRunStateSchema = z
  .object({
    schemaVersion: z.literal(SUPERVISOR_RUN_SCHEMA_VERSION),
    runId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    userId: IdentifierSchema,
    projectId: IdentifierSchema.optional(),
    projectRoot: z.string().trim().min(1).max(4096),
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
    status: SupervisorRunStatusSchema,
    managerSession: SupervisorManagerSessionSchema.optional(),
    plan: SupervisorApprovedPlanSchema.optional(),
    capacityWaits: z.array(SupervisorCapacityWaitSchema).max(1024),
    decisions: z.array(SupervisorManagerDecisionSchema).max(4096),
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
    migratedFromVersion: z.literal(1).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((run, context) => {
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
    if (run.status === "waiting_capacity" && run.capacityWaits.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["capacityWaits"],
        message: "Waiting-capacity runs require a persisted capacity wait",
      });
    }
    if (run.finalCommitSha && run.status !== "completed") {
      context.addIssue({
        code: "custom",
        path: ["finalCommitSha"],
        message: "Only completed runs may contain a final commit SHA",
      });
    }

    const taskIds = new Set<string>();
    for (const [taskIndex, task] of run.tasks.entries()) {
      if (taskIds.has(task.taskId)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "taskId"],
          message: `Duplicate task id: ${task.taskId}`,
        });
      }
      taskIds.add(task.taskId);
      if (task.attempts.length > run.limits.maxAttemptsPerTask) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "attempts"],
          message: "Attempt count exceeds task limit",
        });
      }
    }

    validateDependencyGraph(run.tasks, context);
    validateUniqueBindings(run.tasks, context);
  });

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

export function createDefaultSupervisorRunLimits(): SupervisorRunLimits {
  return { ...SUPERVISOR_RUN_LIMIT_DEFAULTS };
}
