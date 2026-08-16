import { z } from "zod";
import type {
  UsageStatsCostTotals,
  UsageStatsTokenTotals,
} from "#runtime/modules/usage-stats/application/contracts/usage-stats.contract";

export const QuotaProviderSourceSchema = z.enum([
  "remote_api",
  "local_estimation",
  "local_runtime_accounting",
]);

export const QuotaProviderStatusSchema = z.enum([
  "ready",
  "not_configured",
  "unavailable",
  "error",
]);

export const QuotaWindowSchema = z
  .object({
    id: z.string().min(1),
    windowType: z.string().min(1).optional(),
    label: z.string().min(1),
    usageKind: z.enum(["model_tokens", "tool_calls"]).optional(),
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

export const ProviderQuotaErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const ProviderQuotaSnapshotSchema = z
  .object({
    providerId: z.string().min(1),
    displayName: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    source: QuotaProviderSourceSchema,
    status: QuotaProviderStatusSchema,
    attempted: z.boolean(),
    windows: z.array(QuotaWindowSchema),
    checkedAt: z.string().datetime(),
    fetchedAt: z.string().datetime().optional(),
    authSource: z.enum(["env", "local_auth", "credential"]).optional(),
    error: ProviderQuotaErrorSchema.optional(),
  })
  .strict();

export const ListProviderQuotasInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    includeUnavailable: z.boolean().optional(),
    refresh: z.boolean().optional(),
  })
  .strict()
  .optional();

export const RefreshProviderQuotaInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    includeUnavailable: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .optional();

export const GetQuotaCycleUsageInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    includeUnavailable: z.boolean().optional(),
  })
  .strict()
  .optional();

export type QuotaProviderSource = z.infer<typeof QuotaProviderSourceSchema>;
export type QuotaProviderStatus = z.infer<typeof QuotaProviderStatusSchema>;
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;
export type ProviderQuotaSnapshot = z.infer<typeof ProviderQuotaSnapshotSchema>;
export type ListProviderQuotasInput = z.infer<
  typeof ListProviderQuotasInputSchema
>;
export type RefreshProviderQuotaInput = z.infer<
  typeof RefreshProviderQuotaInputSchema
>;
export type GetQuotaCycleUsageInput = z.infer<
  typeof GetQuotaCycleUsageInputSchema
>;

export interface ProviderQuotaListResult {
  providers: ProviderQuotaSnapshot[];
  checkedAt: string;
}

export type QuotaCycleBoundarySource =
  | "provider_reported"
  | "reset_duration"
  | "first_observation"
  | "unavailable";

export type QuotaCycleEstimateConfidence =
  | "unavailable"
  | "low"
  | "medium"
  | "high";

export interface QuotaCycleObservedUsage {
  from?: string;
  to: string;
  partialCycle: boolean;
  localOnly: true;
  tokens: UsageStatsTokenTotals;
  apiEquivalent: UsageStatsCostTotals;
  activeDays: number;
  modelCount: number;
  warnings: string[];
}

export interface QuotaCycleEfficiencyEstimate {
  confidence: QuotaCycleEstimateConfidence;
  sampleCount: number;
  quotaPointsObserved?: number;
  tokensPerQuotaPoint?: number;
  projectedTokenCapacity?: number;
  apiEquivalentPerQuotaPoint?: number;
  projectedApiEquivalent?: number;
  reasons: string[];
}

export interface QuotaCycleUsageWindow {
  windowId: string;
  label: string;
  windowType?: string;
  cycleStartedAt?: string;
  resetAt?: string;
  boundarySource: QuotaCycleBoundarySource;
  observed: QuotaCycleObservedUsage;
  estimate: QuotaCycleEfficiencyEstimate;
}

export interface ProviderQuotaCycleUsage {
  quota: ProviderQuotaSnapshot;
  cycles: QuotaCycleUsageWindow[];
}

export interface QuotaCycleUsageResult {
  providers: ProviderQuotaCycleUsage[];
  checkedAt: string;
}
