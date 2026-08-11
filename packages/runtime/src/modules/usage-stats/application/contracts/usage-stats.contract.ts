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
export type UsageStatsLifecycleRecordKind = Extract<
  UsageStatsRecordKind,
  "prompt_sent" | "turn_completed"
>;

export const UsageStatsQuotaWindowSnapshotSchema = z
  .object({
    id: z.string().min(1),
    windowType: z.string().min(1).optional(),
    label: z.string().min(1),
    percentRemaining: z.number().min(0).max(100).optional(),
    used: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    remaining: z.number().nonnegative().optional(),
    unlimited: z.boolean().optional(),
    startedAt: z.string().datetime().optional(),
    resetAt: z.string().datetime().optional(),
    durationMs: z.number().int().positive().optional(),
    scope: z.string().min(1).optional(),
  })
  .strict();
export type UsageStatsQuotaWindowSnapshot = z.infer<
  typeof UsageStatsQuotaWindowSnapshotSchema
>;

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
    quotaWindows: z.array(UsageStatsQuotaWindowSnapshotSchema).optional(),
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
  "zcode",
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

export interface RecordLifecycleUsageInput {
  kind: UsageStatsLifecycleRecordKind;
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId?: string;
  agentSessionId?: string;
  turnId?: string;
}

export interface RecordQuotaRefreshInput {
  userId: string;
  providerId: string;
  providerDisplayName: string;
  status: string;
  fetchedAt: string;
  windows: UsageStatsQuotaWindowSnapshot[];
}

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

export interface UsageStatsCostTotals {
  inputUsd: number;
  outputUsd: number;
  cacheInputUsd: number;
  cacheOutputUsd: number;
  totalUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
}

export interface UsageStatsPricingMetadata {
  source: string;
  generatedAt: number;
  units: string;
  pricedTokens: number;
  unpricedTokens: number;
}

export interface UsageStatsModelUsage {
  name: string;
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  upstreamProviderId?: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
  share: number;
}

export interface UsageStatsDailyModelUsage {
  name: string;
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  upstreamProviderId?: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
}

export interface UsageStatsProviderDailyUsage {
  providerId: UsageStatsCliProviderId;
  providerDisplayName: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
}

export interface UsageStatsCliDailyUsage {
  date: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
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
  cost: UsageStatsCostTotals;
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
  cost: UsageStatsCostTotals;
  pricing: UsageStatsPricingMetadata;
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
