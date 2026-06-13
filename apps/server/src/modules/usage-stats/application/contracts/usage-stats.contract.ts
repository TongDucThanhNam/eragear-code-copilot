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

export const UsageStatsCliProviderIdSchema = z.enum([
  "amp",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
]);
export type UsageStatsCliProviderId = z.infer<
  typeof UsageStatsCliProviderIdSchema
>;

export const GetUsageStatsSummaryInputSchema = z
  .object({
    range: UsageStatsRangeSchema.optional().default("7d"),
    includeCliUsage: z.boolean().optional().default(true),
    cliProviders: z.array(UsageStatsCliProviderIdSchema).optional(),
  })
  .strict()
  .optional();
export type GetUsageStatsSummaryInput = z.input<
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

export interface UsageStatsTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheInputTokens: number;
  cacheOutputTokens: number;
  totalTokens: number;
}

export interface UsageStatsModelUsage {
  name: string;
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  tokens: UsageStatsTokenTotals;
  share: number;
}

export interface UsageStatsDailyModelUsage {
  name: string;
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  tokens: UsageStatsTokenTotals;
}

export interface UsageStatsProviderDailyUsage {
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  tokens: UsageStatsTokenTotals;
}

export interface UsageStatsCliDailyUsage {
  date: string;
  tokens: UsageStatsTokenTotals;
  displayTokens: number;
  breakdown: UsageStatsDailyModelUsage[];
  providers: UsageStatsProviderDailyUsage[];
}

export type UsageStatsCliProviderStatus = "ready" | "not_found" | "error";

export interface UsageStatsCliProviderSummary {
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  status: UsageStatsCliProviderStatus;
  error?: string;
  totals: UsageStatsTokenTotals;
  daily: UsageStatsCliDailyUsage[];
  modelUsage: UsageStatsModelUsage[];
  favoriteModel?: UsageStatsModelUsage;
  recentFavoriteModel?: UsageStatsModelUsage;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

export interface UsageStatsCliSummary {
  range: UsageStatsRange;
  providers: UsageStatsCliProviderSummary[];
  totals: UsageStatsTokenTotals;
  daily: UsageStatsCliDailyUsage[];
  modelUsage: UsageStatsModelUsage[];
  favoriteModel?: UsageStatsModelUsage;
  recentFavoriteModel?: UsageStatsModelUsage;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  warnings: string[];
  checkedAt: number;
}

export interface UsageStatsSummary {
  telemetry: UsageTelemetrySettings;
  range: UsageStatsRange;
  totals: UsageStatsTotals;
  byDay: UsageStatsBucket[];
  byProject: UsageStatsBucket[];
  recent: UsageStatsRecord[];
  cliUsage?: UsageStatsCliSummary;
  checkedAt: number;
}
