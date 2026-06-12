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
  "running",
  "completed",
  "failed",
  "stopped",
]);

export const BotDefinitionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    prompt: z.string().min(1),
    enabled: z.boolean(),
    trigger: BotTriggerSchema,
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    maxConcurrency: z.number().int().min(1).max(10),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
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
    queuedAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    completedAt: z.number().int().nonnegative().nullable(),
    stoppedAt: z.number().int().nonnegative().nullable(),
    error: z.string().optional(),
  })
  .strict();

export const UpsertBotDefinitionInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    prompt: z.string().min(1).max(32_000),
    enabled: z.boolean().optional(),
    trigger: BotTriggerSchema.optional(),
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
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
  })
  .strict();

export const BotOrchestrationResultSchema = z
  .object({
    trigger: BotTriggerSchema,
    startedRuns: z.array(BotRunSchema),
    skippedBotIds: z.array(z.string()),
  })
  .strict();

export type BotTrigger = z.infer<typeof BotTriggerSchema>;
export type BotRunStatus = z.infer<typeof BotRunStatusSchema>;
export type BotDefinition = z.infer<typeof BotDefinitionSchema>;
export type BotRun = z.infer<typeof BotRunSchema>;
export type UpsertBotDefinitionInput = z.infer<
  typeof UpsertBotDefinitionInputSchema
>;
export type DeleteBotDefinitionInput = z.infer<
  typeof DeleteBotDefinitionInputSchema
>;
export type StartBotRunInput = z.infer<typeof StartBotRunInputSchema>;
export type StopBotRunInput = z.infer<typeof StopBotRunInputSchema>;
export type OrchestrateBotsInput = z.infer<typeof OrchestrateBotsInputSchema>;
export type BotSystemStatus = z.infer<typeof BotSystemStatusSchema>;
export type BotOrchestrationResult = z.infer<
  typeof BotOrchestrationResultSchema
>;
