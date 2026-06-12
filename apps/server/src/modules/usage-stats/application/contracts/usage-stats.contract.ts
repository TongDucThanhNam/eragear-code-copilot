import { z } from "zod";

export const UsageTelemetrySettingsSchema = z
  .object({
    enabled: z.boolean(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type UsageTelemetrySettings = z.infer<
  typeof UsageTelemetrySettingsSchema
>;

export const UsageStatsRecordKindSchema = z.enum([
  "prompt_sent",
  "turn_completed",
  "quota_refreshed",
]);
export type UsageStatsRecordKind = z.infer<typeof UsageStatsRecordKindSchema>;

export const UsageStatsRecordSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    kind: UsageStatsRecordKindSchema,
    projectId: z.string().min(1).optional(),
    projectRoot: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
    agentSessionId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    providerDisplayName: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type UsageStatsRecord = z.infer<typeof UsageStatsRecordSchema>;

export const UsageStatsRangeSchema = z.enum(["24h", "7d", "30d", "all"]);
export type UsageStatsRange = z.infer<typeof UsageStatsRangeSchema>;

export const GetUsageStatsSummaryInputSchema = z
  .object({
    range: UsageStatsRangeSchema.optional().default("7d"),
  })
  .strict()
  .optional();
export type GetUsageStatsSummaryInput = z.infer<
  typeof GetUsageStatsSummaryInputSchema
>;

export const UpdateUsageTelemetryInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateUsageTelemetryInput = z.infer<
  typeof UpdateUsageTelemetryInputSchema
>;

export interface UsageStatsTotals {
  promptCount: number;
  turnCount: number;
  quotaRefreshCount: number;
  activeProjects: number;
  activeChats: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStatsBucket {
  key: string;
  promptCount: number;
  turnCount: number;
  quotaRefreshCount: number;
}

export interface UsageStatsSummary {
  telemetry: UsageTelemetrySettings;
  range: UsageStatsRange;
  totals: UsageStatsTotals;
  byDay: UsageStatsBucket[];
  byProject: UsageStatsBucket[];
  recent: UsageStatsRecord[];
  checkedAt: number;
}
