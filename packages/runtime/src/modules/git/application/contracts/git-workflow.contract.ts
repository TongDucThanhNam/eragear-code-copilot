import { z } from "zod";
import { GitChangedFileSchema } from "./git.contract";

export const GitWorkflowActionSchema = z.enum([
  "commit",
  "push",
  "commit_push",
  "create_pr",
  "commit_push_pr",
]);

export const GitPullRequestSchema = z
  .object({
    url: z.string().url(),
    number: z.number().int().positive().optional(),
    title: z.string().optional(),
    state: z.enum(["open", "closed", "merged"]).default("open"),
  })
  .strict();

export const GitWorkflowStatusSchema = z
  .object({
    isRepository: z.boolean(),
    refName: z.string().min(1).optional(),
    head: z.string().min(1).optional(),
    upstream: z.string().min(1).optional(),
    defaultRef: z.string().min(1).optional(),
    primaryRemote: z.string().min(1).optional(),
    hasWorkingTreeChanges: z.boolean(),
    hasUpstream: z.boolean(),
    hasPrimaryRemote: z.boolean(),
    isDefaultRef: z.boolean(),
    aheadCount: z.number().int().nonnegative(),
    behindCount: z.number().int().nonnegative(),
    changedFiles: z.array(GitChangedFileSchema),
    pr: GitPullRequestSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export const GitWorkflowProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const GitWorkflowActionInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    actionId: z.string().trim().min(1).max(128),
    action: GitWorkflowActionSchema,
    message: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(256).optional(),
    body: z.string().max(20_000).optional(),
    base: z.string().trim().min(1).max(256).optional(),
    draft: z.boolean().optional(),
    confirmDefaultBranch: z.boolean().optional(),
  })
  .strict();

export const GitWorkflowProgressInputSchema = z
  .object({
    actionId: z.string().trim().min(1).max(128),
  })
  .strict();

export const GitBranchDiffInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    base: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const GitWorkflowProgressSchema = z
  .object({
    actionId: z.string().min(1),
    action: GitWorkflowActionSchema,
    stage: z.enum(["status", "commit", "push", "pull_request"]),
    status: z.enum(["running", "completed", "failed"]),
    message: z.string().min(1),
  })
  .strict();

export const GitWorkflowActionResultSchema = z
  .object({
    actionId: z.string().min(1),
    action: GitWorkflowActionSchema,
    status: GitWorkflowStatusSchema,
    commitSha: z.string().min(1).optional(),
    pushed: z.boolean(),
    pr: GitPullRequestSchema.optional(),
  })
  .strict();

export type GitWorkflowAction = z.infer<typeof GitWorkflowActionSchema>;
export type GitPullRequest = z.infer<typeof GitPullRequestSchema>;
export type GitWorkflowStatus = z.infer<typeof GitWorkflowStatusSchema>;
export type GitWorkflowProjectInput = z.infer<
  typeof GitWorkflowProjectInputSchema
>;
export type GitWorkflowActionInput = z.infer<
  typeof GitWorkflowActionInputSchema
>;
export type GitWorkflowProgressInput = z.infer<
  typeof GitWorkflowProgressInputSchema
>;
export type GitBranchDiffInput = z.infer<typeof GitBranchDiffInputSchema>;
export type GitWorkflowProgress = z.infer<typeof GitWorkflowProgressSchema>;
export type GitWorkflowActionResult = z.infer<
  typeof GitWorkflowActionResultSchema
>;
