import { z } from "zod";

export const BotTriggerSchema = z.enum([
  "manual",
  "quota_refresh",
  "repository_change",
  "scheduled",
  "remote_control",
]);

export const BotRunStatusSchema = z.enum([
  "queued",
  "quota_blocked",
  "running",
  "completed",
  "failed",
  "stopped",
]);

export const BotWorkModeSchema = z.enum(["adaptive_session", "supervisor_run"]);

export const BotPromptStrategySchema = z.enum(["supervisor_dynamic", "fixed"]);

export const BotExecutionTargetSchema = z.enum([
  "new_session",
  "existing_session",
  "queue_only",
]);

export const BotExecutionConfigSchema = z
  .object({
    target: BotExecutionTargetSchema.default("new_session"),
    chatId: z.string().trim().min(1).optional(),
  })
  .strict();

export const BotQuotaTriggerConfigSchema = z
  .object({
    providerIds: z.array(z.string().trim().min(1)).max(16).default([]),
    windowIds: z.array(z.string().trim().min(1)).max(64).default([]),
    minPercentRemaining: z.number().min(0).max(100).default(1),
    minRemaining: z.number().nonnegative().optional(),
    cooldownMs: z.number().int().min(0).max(86_400_000).default(300_000),
  })
  .strict();

export const BotTriggerConfigSchema = z
  .object({
    quota: BotQuotaTriggerConfigSchema.optional(),
  })
  .strict();

export const BotRunTriggerContextSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    providerDisplayName: z.string().min(1).optional(),
    windowId: z.string().min(1).optional(),
    windowLabel: z.string().min(1).optional(),
    resetAt: z.string().datetime().optional(),
    percentRemaining: z.number().min(0).max(100).optional(),
    remaining: z.number().nonnegative().optional(),
    source: z.string().min(1).optional(),
  })
  .strict();

export const BotDefinitionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    objective: z.string().min(1),
    prompt: z.string(),
    workMode: BotWorkModeSchema,
    promptStrategy: BotPromptStrategySchema,
    providerId: z.string().trim().min(1).optional(),
    enabled: z.boolean(),
    trigger: BotTriggerSchema,
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    modelId: z.string().trim().min(1).optional(),
    maxConcurrency: z.number().int().min(1).max(10),
    triggerConfig: BotTriggerConfigSchema.optional(),
    execution: BotExecutionConfigSchema.default({ target: "new_session" }),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const BotSupervisorDecisionSchema = z
  .object({
    action: z.enum(["dispatch", "complete", "defer", "failed"]),
    rationale: z.string().trim().min(1).max(1200),
    evidenceSummary: z.string().trim().min(1).max(2400),
    decidedAt: z.number().int().nonnegative(),
    retryable: z.boolean().optional(),
  })
  .strict();

export const BotAdmissionStateSchema = z
  .object({
    status: z.enum([
      "pending",
      "eligible",
      "quota_unavailable",
      "quota_stale",
      "below_reserve",
      "provider_busy",
      "entitlement_required",
      "provider_mismatch",
    ]),
    providerId: z.string().trim().min(1).optional(),
    windowId: z.string().trim().min(1).optional(),
    windowLabel: z.string().trim().min(1).optional(),
    percentRemaining: z.number().min(0).max(100).optional(),
    remaining: z.number().nonnegative().optional(),
    checkedAt: z.number().int().nonnegative(),
    nextCheckAt: z.number().int().nonnegative().optional(),
    reason: z.string().trim().min(1).max(1200).optional(),
    leaseId: z.string().trim().min(1).optional(),
  })
  .strict();

export const BotRunSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    botId: z.string().min(1),
    trigger: BotTriggerSchema,
    status: BotRunStatusSchema,
    context: z.record(z.string(), z.string()).default({}),
    triggerContext: BotRunTriggerContextSchema.optional(),
    dedupeKey: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    agentSessionId: z.string().min(1).optional(),
    providerId: z.string().trim().min(1).optional(),
    promptHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    supervisorRunId: z.string().trim().min(1).optional(),
    decision: BotSupervisorDecisionSchema.optional(),
    admission: BotAdmissionStateSchema.optional(),
    completionState: z
      .enum(["pending", "work_completed", "objective_completed"])
      .default("pending"),
    queuedAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    completedAt: z.number().int().nonnegative().nullable(),
    stoppedAt: z.number().int().nonnegative().nullable(),
    nextAttemptAt: z.number().int().nonnegative().optional(),
    retryable: z.boolean().optional(),
    failureReason: z.string().max(1200).optional(),
    error: z.string().optional(),
  })
  .strict();

export const UpsertBotDefinitionInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    objective: z.string().trim().min(1).max(32_000).optional(),
    prompt: z.string().max(32_000).optional(),
    workMode: BotWorkModeSchema.optional(),
    promptStrategy: BotPromptStrategySchema.optional(),
    providerId: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    trigger: BotTriggerSchema.optional(),
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    modelId: z.string().trim().min(1).optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
    triggerConfig: BotTriggerConfigSchema.optional(),
    execution: BotExecutionConfigSchema.optional(),
  })
  .strict();

export const DeleteBotDefinitionInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const StartBotRunInputSchema = z
  .object({
    botId: z.string().min(1),
    trigger: BotTriggerSchema.optional(),
    context: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const StopBotRunInputSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const SetBotEnabledInputSchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const RunBotNowInputSchema = z
  .object({
    botId: z.string().min(1),
  })
  .strict();

export const RetryBotRunInputSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const BotUpdatesInputSchema = z
  .object({
    botId: z.string().min(1).optional(),
  })
  .strict()
  .optional();

export const OrchestrateBotsInputSchema = z
  .object({
    trigger: BotTriggerSchema,
    context: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const BotSystemStatusSchema = z
  .object({
    bots: z.array(BotDefinitionSchema),
    runs: z.array(BotRunSchema),
    providerLeases: z
      .array(
        z
          .object({
            providerId: z.string().min(1),
            botId: z.string().min(1),
            runId: z.string().min(1),
            acquiredAt: z.number().int().nonnegative(),
            expiresAt: z.number().int().nonnegative(),
          })
          .strict()
      )
      .default([]),
  })
  .strict();

export const BotOrchestrationResultSchema = z
  .object({
    trigger: BotTriggerSchema,
    startedRuns: z.array(BotRunSchema),
    skippedBotIds: z.array(z.string()),
  })
  .strict();

export const BotQuotaAutomationWindowSchema = z
  .object({
    userId: z.string().min(1),
    providerId: z.string().min(1),
    providerDisplayName: z.string().min(1),
    windowId: z.string().min(1),
    windowLabel: z.string().min(1),
    resetAt: z.string().datetime(),
    percentRemaining: z.number().min(0).max(100).optional(),
    remaining: z.number().nonnegative().optional(),
    observedAt: z.number().int().nonnegative(),
    nextCheckAt: z.number().int().nonnegative(),
    lastCheckedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const BotQuotaAutomationDispatchSchema = z
  .object({
    dedupeKey: z.string().min(1),
    userId: z.string().min(1),
    botId: z.string().min(1),
    providerId: z.string().min(1),
    windowId: z.string().min(1),
    resetAt: z.string().datetime(),
    dispatchedAt: z.number().int().nonnegative(),
    runIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const BotQuotaAutomationCooldownSchema = z
  .object({
    userId: z.string().min(1),
    botId: z.string().min(1),
    providerId: z.string().min(1),
    windowId: z.string().min(1),
    lastDispatchedAt: z.number().int().nonnegative(),
  })
  .strict();

export const BotProviderLeaseSchema = z
  .object({
    leaseId: z.string().min(1),
    userId: z.string().min(1),
    providerId: z.string().min(1),
    botId: z.string().min(1),
    runId: z.string().min(1),
    acquiredAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();

export const BotQuotaAutomationStateSchema = z
  .object({
    windows: z.record(z.string(), BotQuotaAutomationWindowSchema).default({}),
    dispatched: z
      .record(z.string(), BotQuotaAutomationDispatchSchema)
      .default({}),
    cooldowns: z
      .record(z.string(), BotQuotaAutomationCooldownSchema)
      .default({}),
    providerLeases: z.record(z.string(), BotProviderLeaseSchema).default({}),
  })
  .strict();

export type BotTrigger = z.infer<typeof BotTriggerSchema>;
export type BotRunStatus = z.infer<typeof BotRunStatusSchema>;
export type BotWorkMode = z.infer<typeof BotWorkModeSchema>;
export type BotPromptStrategy = z.infer<typeof BotPromptStrategySchema>;
export type BotExecutionTarget = z.infer<typeof BotExecutionTargetSchema>;
export type BotExecutionConfig = z.infer<typeof BotExecutionConfigSchema>;
export type BotQuotaTriggerConfig = z.infer<typeof BotQuotaTriggerConfigSchema>;
export type BotTriggerConfig = z.infer<typeof BotTriggerConfigSchema>;
export type BotRunTriggerContext = z.infer<typeof BotRunTriggerContextSchema>;
export type BotDefinition = z.infer<typeof BotDefinitionSchema>;
export type BotRun = z.infer<typeof BotRunSchema>;
export type BotSupervisorDecision = z.infer<typeof BotSupervisorDecisionSchema>;
export type BotAdmissionState = z.infer<typeof BotAdmissionStateSchema>;
export type UpsertBotDefinitionInput = z.infer<
  typeof UpsertBotDefinitionInputSchema
>;
export type DeleteBotDefinitionInput = z.infer<
  typeof DeleteBotDefinitionInputSchema
>;
export type StartBotRunInput = z.infer<typeof StartBotRunInputSchema>;
export type StopBotRunInput = z.infer<typeof StopBotRunInputSchema>;
export type SetBotEnabledInput = z.infer<typeof SetBotEnabledInputSchema>;
export type RunBotNowInput = z.infer<typeof RunBotNowInputSchema>;
export type RetryBotRunInput = z.infer<typeof RetryBotRunInputSchema>;
export type BotUpdatesInput = z.infer<typeof BotUpdatesInputSchema>;
export type OrchestrateBotsInput = z.infer<typeof OrchestrateBotsInputSchema>;
export type BotSystemStatus = z.infer<typeof BotSystemStatusSchema>;
export type BotOrchestrationResult = z.infer<
  typeof BotOrchestrationResultSchema
>;
export type BotQuotaAutomationWindow = z.infer<
  typeof BotQuotaAutomationWindowSchema
>;
export type BotQuotaAutomationDispatch = z.infer<
  typeof BotQuotaAutomationDispatchSchema
>;
export type BotQuotaAutomationCooldown = z.infer<
  typeof BotQuotaAutomationCooldownSchema
>;
export type BotProviderLease = z.infer<typeof BotProviderLeaseSchema>;
export type BotQuotaAutomationState = z.infer<
  typeof BotQuotaAutomationStateSchema
>;

export type BotQuotaSnapshotStatus =
  | "ready"
  | "not_configured"
  | "unavailable"
  | "error";

export interface CompleteBotRunsForTurnInput {
  userId: string;
  chatId: string;
  turnId: string;
  stopReason?: string;
}

export interface StopBotRunsForSessionInput {
  userId: string;
  chatId: string;
  stopReason?: string;
}

export interface BotQuotaSnapshotWindowInput {
  id: string;
  windowType?: string;
  label: string;
  percentRemaining?: number;
  remaining?: number;
  resetAt?: string;
}

export interface RecordBotQuotaSnapshotInput {
  userId: string;
  providerId: string;
  providerDisplayName: string;
  status: BotQuotaSnapshotStatus;
  windows: BotQuotaSnapshotWindowInput[];
}
