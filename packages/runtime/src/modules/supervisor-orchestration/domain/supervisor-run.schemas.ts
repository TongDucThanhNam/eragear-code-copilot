import { z } from "zod";

export const SUPERVISOR_RUN_SCHEMA_VERSION = 1 as const;
export const SUPERVISOR_RUN_LIMIT_DEFAULTS = {
  maxConcurrency: 2,
  maxTasks: 12,
  maxAttemptsPerTask: 2,
  maxRunDurationMs: 2 * 60 * 60 * 1000,
  maxPlannerReplans: 2,
} as const;
export const SUPERVISOR_RUN_LIMIT_CAPS = {
  maxConcurrency: 8,
  maxTasks: 32,
  maxAttemptsPerTask: 5,
  maxRunDurationMs: 24 * 60 * 60 * 1000,
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
  "queued",
  "running",
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
    maxRunDurationMs: z
      .number()
      .int()
      .min(1)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxRunDurationMs),
    maxPlannerReplans: z
      .number()
      .int()
      .min(0)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxPlannerReplans),
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
    status: z.enum(["starting", "running", "terminal", "interrupted"]),
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
    scheduleId: IdentifierSchema.optional(),
    providerId: IdentifierSchema.optional(),
    workerModelId: z.string().trim().min(1).max(512).optional(),
    eligibleAgentIds: z.array(IdentifierSchema).max(32).optional(),
    originalIntent: z.string().trim().min(1).max(32_000),
    constraints: z.array(z.string().trim().min(1).max(4000)).max(128),
    status: SupervisorRunStatusSchema,
    baseSnapshot: z
      .object({
        head: z.string().trim().min(1).max(1024).optional(),
        dirtyPaths: z.array(RelativePathSchema).max(4096),
        targetFingerprints: z
          .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
          .default({}),
        capturedAt: TimestampSchema,
      })
      .strict(),
    limits: SupervisorRunLimitsSchema,
    tasks: z
      .array(SupervisorTaskRecordSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
    gates: z.array(SupervisorGateRecordSchema).max(4096),
    audit: z.array(SupervisorRunAuditEntrySchema).max(20_000),
    processedEventIds: z.array(IdentifierSchema).max(20_000),
    plannerReplanCount: z.number().int().nonnegative(),
    finalVerification: z.array(SupervisorVerificationEvidenceSchema).max(64),
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
