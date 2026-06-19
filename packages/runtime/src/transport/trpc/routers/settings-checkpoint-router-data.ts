import { z } from "zod";

const CheckpointFileSelectionRequestSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(24);

export const CreateCheckpointRequestSchema = z
  .object({
    projectId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const PreviewCheckpointRequestSchema = z
  .object({
    projectId: z.string().optional(),
    checkpointId: z.string().trim().min(1),
  })
  .strict();

export const RestoreCheckpointRequestSchema = z
  .object({
    projectId: z.string().optional(),
    checkpointId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
  })
  .strict();

export const RestoreCheckpointFilesRequestSchema =
  RestoreCheckpointRequestSchema.extend({
    files: CheckpointFileSelectionRequestSchema,
  }).strict();

export const ShelveCheckpointConflictsRequestSchema =
  RestoreCheckpointRequestSchema.extend({
    files: CheckpointFileSelectionRequestSchema,
  }).strict();

export const ResolveCheckpointTrackedConflictsRequestSchema =
  RestoreCheckpointRequestSchema.extend({
    files: CheckpointFileSelectionRequestSchema,
  }).strict();

export const ResolveCheckpointTrackedConflictChoiceRequestSchema =
  RestoreCheckpointRequestSchema.extend({
    files: CheckpointFileSelectionRequestSchema,
    resolution: z.enum(["restore", "current"]),
  }).strict();

export const RestoreCheckpointHunksRequestSchema =
  RestoreCheckpointRequestSchema.extend({
    hunks: z
      .array(
        z
          .object({
            file: z.string().trim().min(1),
            hunkIndex: z.number().int().nonnegative(),
          })
          .strict()
      )
      .min(1)
      .max(24),
  }).strict();

export const ResolveCheckpointTrackedConflictHunksRequestSchema =
  RestoreCheckpointHunksRequestSchema;
