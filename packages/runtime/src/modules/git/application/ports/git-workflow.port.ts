import type {
  GitPullRequest,
  GitWorkflowAction,
  GitWorkflowProgress,
  GitWorkflowStatus,
} from "../contracts/git-workflow.contract";

export interface GitWorkflowCommitResult {
  commitSha: string;
}

export interface GitWorkflowPushResult {
  branch: string;
  upstream: string;
}

export interface GitWorkflowRunInput {
  projectRoot: string;
  actionId: string;
  action: GitWorkflowAction;
  message?: string;
  title?: string;
  body?: string;
  base?: string;
  draft?: boolean;
}

export interface GitWorkflowRunResult {
  commitSha?: string;
  pushed: boolean;
  pr?: GitPullRequest;
}

export interface GitWorktree {
  path: string;
  head?: string;
  branchName?: string;
  bare: boolean;
  detached: boolean;
}

export interface GitWorkflowPort {
  getStatus(projectRoot: string): Promise<GitWorkflowStatus>;
  commit(input: {
    projectRoot: string;
    message?: string;
  }): Promise<GitWorkflowCommitResult>;
  push(input: { projectRoot: string }): Promise<GitWorkflowPushResult>;
  commitAndPush(input: {
    projectRoot: string;
    message?: string;
  }): Promise<GitWorkflowCommitResult & GitWorkflowPushResult>;
  createPullRequest(input: {
    projectRoot: string;
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
  }): Promise<GitPullRequest>;
  runStackedAction(
    input: GitWorkflowRunInput,
    onProgress?: (event: GitWorkflowProgress) => void
  ): Promise<GitWorkflowRunResult>;
  createWorktree(input: {
    projectRoot: string;
    worktreeId: string;
    branchName?: string;
  }): Promise<GitWorktree>;
  listWorktrees(input: { projectRoot: string }): Promise<GitWorktree[]>;
  removeWorktree(input: {
    projectRoot: string;
    worktreePath: string;
  }): Promise<void>;
  getBranchDiff(input: { projectRoot: string; base?: string }): Promise<string>;
}
