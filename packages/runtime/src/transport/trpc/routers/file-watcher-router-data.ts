import { z } from "zod";
import type { FileWatcherStatusInput } from "#runtime/modules/file-watcher";

export const FileWatcherStatusRequestSchema = z
  .object({
    currentUserOnly: z.boolean().optional(),
  })
  .strict()
  .optional();

export type FileWatcherStatusRequest = z.infer<
  typeof FileWatcherStatusRequestSchema
>;

export function createFileWatcherStatusInput(
  input: FileWatcherStatusRequest,
  userId: string
): FileWatcherStatusInput {
  if (input?.currentUserOnly === false) {
    return undefined;
  }

  return { userId };
}
