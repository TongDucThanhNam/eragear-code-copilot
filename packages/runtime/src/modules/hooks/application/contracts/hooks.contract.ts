import { z } from "zod";

export const HookRunStatusSchema = z.enum([
  "success",
  "failed",
  "timeout",
  "disabled",
]);

export const ExecutionPolicyPresetSchema = z.enum([
  "standard",
  "restricted",
  "blocked",
]);

export const HookLifecycleFailureModeSchema = z.enum([
  "continue",
  "stop-on-failure",
]);

export const AuditReviewStateSchema = z.enum(["all", "reviewed", "open"]);

export const HooksProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const UpsertHookInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    event: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    policyPreset: ExecutionPolicyPresetSchema.optional(),
    envKeys: z.array(z.string().trim().min(1)).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDirectory: z.string().trim().min(1).optional(),
  })
  .strict();

export const ToggleHookInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const UpdateHookLifecyclePolicyInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    disabledEvents: z.array(z.string().trim().min(1)).optional(),
    failureMode: HookLifecycleFailureModeSchema.optional(),
  })
  .strict();

export const UpdateHookSchedulingPolicyInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    maxConcurrentRuns: z.number().int().positive().max(4).optional(),
    cooldownMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict();

export const TrustHookInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    hookId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const ApproveHookRunInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    hookId: z.string().trim().min(1),
    operationFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const RunHookInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    hookId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
    operationApprovalId: z.string().trim().min(1),
  })
  .strict();

export const RunHookBatchInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    hookIds: z.array(z.string().trim().min(1)).min(1).max(8),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
    failureMode: HookLifecycleFailureModeSchema.optional(),
  })
  .strict();

export const ReviewHookRunInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1),
    reviewed: z.boolean(),
  })
  .strict();

export const ExportHookRunsInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    reviewState: AuditReviewStateSchema.optional(),
    status: HookRunStatusSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .optional();

const HookRunSchema = z.object({
  id: z.string().min(1),
  hookId: z.string().min(1),
  hookName: z.string().min(1),
  event: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  status: HookRunStatusSchema,
  stdout: z.string(),
  stderr: z.string(),
  diagnostics: z.array(z.string()),
  reviewedAt: z.string().optional(),
});

const HookLifecyclePolicySchema = z.object({
  enabled: z.boolean(),
  disabledEvents: z.array(z.string()),
  failureMode: HookLifecycleFailureModeSchema,
  updatedAt: z.string().optional(),
  diagnostics: z.array(z.string()),
});

const HookSchedulingPolicySchema = z.object({
  enabled: z.boolean(),
  maxConcurrentRuns: z.number().int().positive(),
  cooldownMs: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
  diagnostics: z.array(z.string()),
});

const HookBatchSchema = z.object({
  id: z.string().min(1),
  hookIds: z.array(z.string()),
  hookNames: z.array(z.string()),
  runIds: z.array(z.string()),
  failureMode: HookLifecycleFailureModeSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  status: z.enum(["success", "partial", "failed", "blocked"]),
  counts: z.record(HookRunStatusSchema, z.number().int().nonnegative()),
  diagnostics: z.array(z.string()),
});

export const HookDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  event: z.string().min(1),
  enabled: z.boolean(),
  policyPreset: ExecutionPolicyPresetSchema,
  envKeys: z.array(z.string()),
  fingerprint: z.string().min(1),
  trustStatus: z.enum(["trusted", "untrusted", "changed"]),
  command: z.string().min(1),
  args: z.array(z.string()),
  timeoutMs: z.number().int().positive(),
  workingDirectory: z.string().optional(),
  sourcePath: z.string().min(1),
  updatedAt: z.string().min(1),
  runConfirmationToken: z.string().min(1),
  runOperation: z.object({
    fingerprint: z.string().min(1),
    approvalStatus: z.enum([
      "missing",
      "approved",
      "expired",
      "consumed",
      "changed",
    ]),
    approvalId: z.string().optional(),
    command: z.string().min(1),
    args: z.array(z.string()),
    event: z.string().min(1),
    diagnostics: z.array(z.string()),
  }),
  executionPolicy: z.object({
    status: z.enum(["allowed", "blocked"]),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  scheduling: z.object({
    status: z.enum(["ready", "paused", "cooldown", "parallel-limit"]),
    activeRuns: z.number().int().nonnegative(),
    maxConcurrentRuns: z.number().int().positive(),
    cooldownMs: z.number().int().nonnegative(),
    diagnostics: z.array(z.string()),
  }),
  lastRun: HookRunSchema.optional(),
  diagnostics: z.array(z.string()),
});

export const HooksDataSchema = z
  .object({
    configPath: z.string().min(1),
    lifecyclePolicy: HookLifecyclePolicySchema,
    schedulingPolicy: HookSchedulingPolicySchema,
    hooks: z.array(HookDescriptorSchema),
    recentRuns: z.array(HookRunSchema),
    recentBatches: z.array(HookBatchSchema),
  })
  .strict();

export const HooksListResultSchema = HooksDataSchema.extend({
  enabledCount: z.number().int().nonnegative(),
  readyCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  trustedCount: z.number().int().nonnegative(),
}).strict();

export const HookRunExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1),
  projectRoot: z.string().min(1),
  filters: z.object({
    reviewState: AuditReviewStateSchema,
    status: HookRunStatusSchema.optional(),
    limit: z.number().int().positive(),
  }),
  redacted: z.literal(true),
  stats: z.object({
    total: z.number().int().nonnegative(),
    matching: z.number().int().nonnegative(),
    included: z.number().int().nonnegative(),
    reviewed: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    statuses: z.record(HookRunStatusSchema, z.number().int().nonnegative()),
  }),
  runs: z.array(HookRunSchema),
  diagnostics: z.array(z.string()),
});

export type HooksProjectInput = z.infer<typeof HooksProjectInputSchema>;
export type UpsertHookInput = z.infer<typeof UpsertHookInputSchema>;
export type ToggleHookInput = z.infer<typeof ToggleHookInputSchema>;
export type UpdateHookLifecyclePolicyInput = z.infer<
  typeof UpdateHookLifecyclePolicyInputSchema
>;
export type UpdateHookSchedulingPolicyInput = z.infer<
  typeof UpdateHookSchedulingPolicyInputSchema
>;
export type TrustHookInput = z.infer<typeof TrustHookInputSchema>;
export type ApproveHookRunInput = z.infer<typeof ApproveHookRunInputSchema>;
export type RunHookInput = z.infer<typeof RunHookInputSchema>;
export type RunHookBatchInput = z.infer<typeof RunHookBatchInputSchema>;
export type ReviewHookRunInput = z.infer<typeof ReviewHookRunInputSchema>;
export type ExportHookRunsInput = z.infer<typeof ExportHookRunsInputSchema>;
export type HookDescriptor = z.infer<typeof HookDescriptorSchema>;
export type HooksData = z.infer<typeof HooksDataSchema>;
export type HooksListResult = z.infer<typeof HooksListResultSchema>;
export type HookRunExport = z.infer<typeof HookRunExportSchema>;
