import { z } from "zod";

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
    percentRemaining: z.number().min(0).max(100).optional(),
    used: z.number().nonnegative().optional(),
    total: z.number().nonnegative().optional(),
    remaining: z.number().nonnegative().optional(),
    unlimited: z.boolean().optional(),
    resetAt: z.string().datetime().optional(),
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

export interface ProviderQuotaListResult {
  providers: ProviderQuotaSnapshot[];
  checkedAt: string;
}
