import { z } from "zod";

export const GitProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const GitFileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
  "unknown",
]);

export const GitChangedFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).optional(),
    status: GitFileStatusSchema,
    staged: z.boolean(),
    unstaged: z.boolean(),
  })
  .strict();

export const GitRepositorySummarySchema = z
  .object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectRoot: z.string().min(1),
    isRepository: z.boolean(),
    branch: z.string().min(1).optional(),
    head: z.string().min(1).optional(),
    upstream: z.string().min(1).optional(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    changedFiles: z.array(GitChangedFileSchema),
    totalChanged: z.number().int().nonnegative(),
    stagedCount: z.number().int().nonnegative(),
    unstagedCount: z.number().int().nonnegative(),
    untrackedCount: z.number().int().nonnegative(),
    checkedAt: z.string().datetime(),
    error: z.string().optional(),
  })
  .strict();

export const GitCheckpointKindSchema = z.enum(["manual", "auto", "safety"]);

export const TurnDiffFileKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
]);

export const TurnDiffFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).optional(),
    kind: TurnDiffFileKindSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  })
  .strict();

export const GitTurnCheckpointKindSchema = z.enum(["baseline", "turn"]);

export const GitTurnCheckpointSchema = z
  .object({
    sessionId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    turnCount: z.number().int().nonnegative(),
    kind: GitTurnCheckpointKindSchema,
    ref: z.string().startsWith("refs/eragear/session-"),
    commitSha: z.string().regex(/^[0-9a-f]{40,64}$/i),
    createdAt: z.string().datetime(),
  })
  .strict();

export const GitTurnCheckpointSessionInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const GitTurnCheckpointDiffInputSchema =
  GitTurnCheckpointSessionInputSchema.extend({
    fromTurnCount: z.number().int().nonnegative(),
    toTurnCount: z.number().int().nonnegative(),
  }).strict();

export const GitTurnCheckpointCreateInputSchema =
  GitTurnCheckpointSessionInputSchema.extend({
    turnId: z.string().trim().min(1).optional(),
  }).strict();

export const GitTurnCheckpointRevertInputSchema =
  GitTurnCheckpointSessionInputSchema.extend({
    turnCount: z.number().int().nonnegative(),
  }).strict();

export const GitTurnCheckpointListResultSchema = z
  .object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectRoot: z.string().min(1),
    checkpoints: z.array(GitTurnCheckpointSchema),
    checkedAt: z.string().datetime(),
  })
  .strict();

export const GitTurnCheckpointDiffResultSchema = z
  .object({
    from: GitTurnCheckpointSchema,
    to: GitTurnCheckpointSchema,
    files: z.array(TurnDiffFileSchema),
  })
  .strict();

export const GitTurnCheckpointRevertResultSchema = z
  .object({
    checkpoint: GitTurnCheckpointSchema,
    safetyRef: z.string().startsWith("refs/eragear/session-"),
    deletedRefs: z.array(z.string().startsWith("refs/eragear/session-")),
    rolledBackTurns: z.number().int().nonnegative(),
    replayedMessages: z.number().int().nonnegative(),
  })
  .strict();

export const GitCheckpointCreateInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .optional();

export const GitCheckpointListInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .optional();

export const GitCheckpointRestoreInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    checkpointId: z.string().trim().min(1),
  })
  .strict();

export const GitCheckpointSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: GitCheckpointKindSchema,
    projectId: z.string().min(1).optional(),
    projectName: z.string().min(1).optional(),
    projectRoot: z.string().min(1),
    createdAt: z.string().datetime(),
    restoredAt: z.string().datetime().optional(),
    chatId: z.string().min(1).optional(),
    agentSessionId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    gitHead: z.string().min(1).optional(),
    changedFiles: z.array(GitChangedFileSchema),
    statusLines: z.array(z.string()),
    patchBytes: z.number().int().nonnegative(),
    canRestore: z.boolean(),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const GitCheckpointListResultSchema = z
  .object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectRoot: z.string().min(1),
    checkpoints: z.array(GitCheckpointSchema),
    checkedAt: z.string().datetime(),
  })
  .strict();

export const GitCheckpointRestoreResultSchema = z
  .object({
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    projectRoot: z.string().min(1),
    checkpoint: GitCheckpointSchema,
    safetyCheckpoint: GitCheckpointSchema.optional(),
    restoredAt: z.string().datetime(),
  })
  .strict();

export type GitProjectInput = z.infer<typeof GitProjectInputSchema>;
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;
export type GitChangedFile = z.infer<typeof GitChangedFileSchema>;
export type GitRepositorySummary = z.infer<typeof GitRepositorySummarySchema>;
export type GitCheckpointKind = z.infer<typeof GitCheckpointKindSchema>;
export type TurnDiffFileKind = z.infer<typeof TurnDiffFileKindSchema>;
export type TurnDiffFile = z.infer<typeof TurnDiffFileSchema>;
export type GitTurnCheckpointKind = z.infer<typeof GitTurnCheckpointKindSchema>;
export type GitTurnCheckpoint = z.infer<typeof GitTurnCheckpointSchema>;
export type GitTurnCheckpointSessionInput = z.infer<
  typeof GitTurnCheckpointSessionInputSchema
>;
export type GitTurnCheckpointDiffInput = z.infer<
  typeof GitTurnCheckpointDiffInputSchema
>;
export type GitTurnCheckpointCreateInput = z.infer<
  typeof GitTurnCheckpointCreateInputSchema
>;
export type GitTurnCheckpointRevertInput = z.infer<
  typeof GitTurnCheckpointRevertInputSchema
>;
export type GitTurnCheckpointListResult = z.infer<
  typeof GitTurnCheckpointListResultSchema
>;
export type GitTurnCheckpointDiffResult = z.infer<
  typeof GitTurnCheckpointDiffResultSchema
>;
export type GitTurnCheckpointRevertResult = z.infer<
  typeof GitTurnCheckpointRevertResultSchema
>;
export type GitCheckpointCreateInput = z.infer<
  typeof GitCheckpointCreateInputSchema
>;
export type GitCheckpointListInput = z.infer<
  typeof GitCheckpointListInputSchema
>;
export type GitCheckpointRestoreInput = z.infer<
  typeof GitCheckpointRestoreInputSchema
>;
export type GitCheckpoint = z.infer<typeof GitCheckpointSchema>;
export type GitCheckpointListResult = z.infer<
  typeof GitCheckpointListResultSchema
>;
export type GitCheckpointRestoreResult = z.infer<
  typeof GitCheckpointRestoreResultSchema
>;
