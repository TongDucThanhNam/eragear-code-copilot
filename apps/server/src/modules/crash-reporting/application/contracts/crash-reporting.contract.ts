import { z } from "zod";

export const CrashSourceSchema = z.enum(["server", "web", "desktop"]);
export const CrashLevelSchema = z.enum(["fatal", "error", "warning", "info"]);

export const CrashReportingConfigSchema = z
  .object({
    enabled: z.boolean(),
    sentryDsn: z.string().default(""),
    captureUnhandled: z.boolean(),
    includeStack: z.boolean(),
    archiveLimit: z.number().int().min(10).max(1000),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const SentryDeliverySchema = z
  .object({
    attempted: z.boolean(),
    ok: z.boolean(),
    status: z.number().int().nullable(),
    error: z.string().optional(),
  })
  .strict();

export const CrashReportSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1).nullable(),
    source: CrashSourceSchema,
    level: CrashLevelSchema,
    message: z.string().min(1),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
    metadata: z.record(z.string(), z.string()).default({}),
    createdAt: z.number().int().nonnegative(),
    sentry: SentryDeliverySchema,
  })
  .strict();

export const UpdateCrashReportingConfigInputSchema =
  CrashReportingConfigSchema.omit({ updatedAt: true }).partial().strict();

export const CaptureCrashReportInputSchema = z
  .object({
    source: CrashSourceSchema,
    level: CrashLevelSchema.default("error"),
    message: z.string().min(1).max(10_000),
    stack: z.string().max(100_000).optional(),
    componentStack: z.string().max(100_000).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const CrashReportingStatusSchema = z
  .object({
    config: CrashReportingConfigSchema,
    reports: z.array(CrashReportSchema),
  })
  .strict();

export type CrashSource = z.infer<typeof CrashSourceSchema>;
export type CrashLevel = z.infer<typeof CrashLevelSchema>;
export type CrashReportingConfig = z.infer<
  typeof CrashReportingConfigSchema
>;
export type SentryDelivery = z.infer<typeof SentryDeliverySchema>;
export type CrashReport = z.infer<typeof CrashReportSchema>;
export type UpdateCrashReportingConfigInput = z.infer<
  typeof UpdateCrashReportingConfigInputSchema
>;
export type CaptureCrashReportInput = z.infer<
  typeof CaptureCrashReportInputSchema
>;
export type CrashReportingStatus = z.infer<typeof CrashReportingStatusSchema>;
