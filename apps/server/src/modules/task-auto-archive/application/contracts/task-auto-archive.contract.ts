import { z } from "zod";

export const DEFAULT_TASK_AUTO_ARCHIVE_OLDER_THAN_DAYS = 7;

export const TaskAutoArchiveSettingsSchema = z
  .object({
    enabled: z.boolean(),
    olderThanDays: z.number().int().positive().max(365),
    userConfigured: z.boolean(),
    updatedAt: z.string().min(1),
    lastRunAt: z.string().min(1).optional(),
  })
  .strict();

export const UpdateTaskAutoArchiveSettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    olderThanDays: z.number().int().positive().max(365).optional(),
  })
  .strict();

export const RunTaskAutoArchiveInputSchema = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict()
  .optional();

export const RunTaskAutoArchiveForUsersInputSchema = z
  .object({
    userIds: z.array(z.string().trim().min(1)).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .optional();

export const TaskAutoArchiveRunResultSchema = z
  .object({
    checkedAt: z.string().min(1),
    cutoffMs: z.number().int().nonnegative(),
    dryRun: z.boolean(),
    inspected: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    skippedPinned: z.number().int().nonnegative(),
    skippedRunning: z.number().int().nonnegative(),
    skippedArchived: z.number().int().nonnegative(),
    skippedRecent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    userIds: z.array(z.string()),
    archivedSessionIds: z.array(z.string()),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const TaskAutoArchiveStatusSchema = z
  .object({
    settings: TaskAutoArchiveSettingsSchema,
    lastRun: TaskAutoArchiveRunResultSchema.optional(),
  })
  .strict();

export type TaskAutoArchiveSettings = z.infer<
  typeof TaskAutoArchiveSettingsSchema
>;
export type UpdateTaskAutoArchiveSettingsInput = z.infer<
  typeof UpdateTaskAutoArchiveSettingsInputSchema
>;
export type RunTaskAutoArchiveInput = z.infer<
  typeof RunTaskAutoArchiveInputSchema
>;
export type RunTaskAutoArchiveForUsersInput = z.infer<
  typeof RunTaskAutoArchiveForUsersInputSchema
>;
export type TaskAutoArchiveRunResult = z.infer<
  typeof TaskAutoArchiveRunResultSchema
>;
export type TaskAutoArchiveStatus = z.infer<typeof TaskAutoArchiveStatusSchema>;
