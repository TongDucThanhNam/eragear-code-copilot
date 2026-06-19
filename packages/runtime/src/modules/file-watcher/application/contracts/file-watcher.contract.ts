import { z } from "zod";

export const FileWatcherSessionInputSchema = z
  .object({
    userId: z.string().trim().min(1),
    chatId: z.string().trim().min(1),
    projectRoot: z.string().trim().min(1),
    projectId: z.string().trim().min(1).optional(),
  })
  .strict();

export const UnwatchSessionInputSchema = z
  .object({
    chatId: z.string().trim().min(1),
  })
  .strict();

export const FileWatcherStatusInputSchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const FileWatcherRootStatusSchema = z
  .object({
    projectRoot: z.string().min(1),
    watched: z.boolean(),
    chatIds: z.array(z.string()),
    error: z.string().optional(),
  })
  .strict();

export const FileWatcherSnapshotSchema = z
  .object({
    roots: z.array(FileWatcherRootStatusSchema),
    sessionCount: z.number().int().nonnegative(),
  })
  .strict();

export type FileWatcherSessionInput = z.infer<
  typeof FileWatcherSessionInputSchema
>;
export type UnwatchSessionInput = z.infer<typeof UnwatchSessionInputSchema>;
export type FileWatcherStatusInput = z.infer<
  typeof FileWatcherStatusInputSchema
>;
export type FileWatcherRootStatus = z.infer<typeof FileWatcherRootStatusSchema>;
export type FileWatcherSnapshot = z.infer<typeof FileWatcherSnapshotSchema>;
