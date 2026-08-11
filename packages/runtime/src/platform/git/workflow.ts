import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  GitPullRequest,
  GitRepositoryPort,
  GitWorkflowAction,
  GitWorkflowPort,
  GitWorkflowProgress,
  GitWorkflowPushResult,
  GitWorkflowRunInput,
  GitWorkflowRunResult,
  GitWorkflowStatus,
  GitWorktree,
} from "#runtime/modules/git";
import { createLogger } from "#runtime/platform/logging/structured-logger";
import { getStorageDirPath } from "#runtime/platform/storage/storage-path";
import { ValidationError } from "#runtime/shared/errors";
import { toError } from "#runtime/shared/utils/error.util";

const execFileAsync = promisify(execFile);
const logger = createLogger("Storage");
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_COMMIT_MESSAGE = "Update from Eragear";
const LINE_BREAK_REGEX = /\r?\n/;
const HTTPS_URL_REGEX = /^https:\/\//;
const ORIGIN_PREFIX_REGEX = /^origin\//;
const WORKTREE_BRANCH_PREFIX = "eragear/worktree/";
const SAFE_WORKTREE_ID_REGEX = /[^A-Za-z0-9._-]+/g;
const WORKTREE_BLOCK_BREAK_REGEX = /\r?\n\r?\n/;
const LOCAL_BRANCH_REF_PREFIX_REGEX = /^refs\/heads\//;
const EDGE_DASH_REGEX = /^-+|-+$/g;

interface CommandResult {
  stdout: string;
  stderr: string;
}

type CommandExecutor = (
  command: string,
  args: string[],
  cwd: string
) => Promise<CommandResult>;

type StorageRootResolver = () => Promise<string>;

const defaultCommandExecutor: CommandExecutor = async (command, args, cwd) =>
  await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });

export class GitWorkflowAdapter implements GitWorkflowPort {
  private readonly repository: GitRepositoryPort;
  private readonly executeCommand: CommandExecutor;
  private readonly storageRoot: StorageRootResolver;

  constructor(
    repository: GitRepositoryPort,
    executeCommand: CommandExecutor = defaultCommandExecutor,
    storageRoot: StorageRootResolver = getStorageDirPath
  ) {
    this.repository = repository;
    this.executeCommand = executeCommand;
    this.storageRoot = storageRoot;
  }

  async getStatus(projectRoot: string): Promise<GitWorkflowStatus> {
    const state = await this.repository.getRepositoryState(projectRoot);
    if (!state.isRepository) {
      return {
        isRepository: false,
        hasWorkingTreeChanges: false,
        hasUpstream: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        aheadCount: 0,
        behindCount: 0,
        changedFiles: [],
        ...(state.error ? { error: state.error } : {}),
      };
    }
    const origin = await this.tryCommand(
      "git",
      ["remote", "get-url", "origin"],
      projectRoot
    );
    const defaultRef = await this.resolveDefaultRef(projectRoot, state.branch);
    return {
      isRepository: true,
      ...(state.branch ? { refName: state.branch } : {}),
      ...(state.head ? { head: state.head } : {}),
      ...(state.upstream ? { upstream: state.upstream } : {}),
      ...(defaultRef ? { defaultRef } : {}),
      ...(origin?.stdout.trim() ? { primaryRemote: "origin" } : {}),
      hasWorkingTreeChanges: state.changedFiles.length > 0,
      hasUpstream: Boolean(state.upstream),
      hasPrimaryRemote: Boolean(origin?.stdout.trim()),
      isDefaultRef: Boolean(
        state.branch && defaultRef && state.branch === defaultRef
      ),
      aheadCount: state.ahead,
      behindCount: state.behind,
      changedFiles: state.changedFiles,
      ...(state.error ? { error: state.error } : {}),
    };
  }

  async commit(input: {
    projectRoot: string;
    message?: string;
  }): Promise<{ commitSha: string }> {
    const message = input.message?.trim() || DEFAULT_COMMIT_MESSAGE;
    await this.runWrite("commit-stage", input.projectRoot, ["add", "--all"]);
    await this.runWrite("commit", input.projectRoot, ["commit", "-m", message]);
    const head = await this.runGit(["rev-parse", "HEAD"], input.projectRoot);
    return { commitSha: head.stdout.trim() };
  }

  async push(input: { projectRoot: string }): Promise<GitWorkflowPushResult> {
    const status = await this.getStatus(input.projectRoot);
    if (!(status.isRepository && status.refName)) {
      throw this.validationError(
        "A named Git branch is required to push",
        "push"
      );
    }
    if (status.hasUpstream && status.upstream) {
      await this.runWrite("push", input.projectRoot, ["push"]);
      return { branch: status.refName, upstream: status.upstream };
    }
    if (!status.hasPrimaryRemote) {
      throw this.validationError("The repository has no origin remote", "push");
    }
    await this.runWrite("push", input.projectRoot, [
      "push",
      "--set-upstream",
      "origin",
      status.refName,
    ]);
    return { branch: status.refName, upstream: `origin/${status.refName}` };
  }

  async commitAndPush(input: {
    projectRoot: string;
    message?: string;
  }): Promise<{ commitSha: string; branch: string; upstream: string }> {
    const commit = await this.commit(input);
    const push = await this.push(input);
    return { ...commit, ...push };
  }

  async createPullRequest(input: {
    projectRoot: string;
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
  }): Promise<GitPullRequest> {
    const args = ["pr", "create"];
    if (input.title) {
      args.push("--title", input.title);
    } else {
      args.push("--fill");
    }
    if (input.body !== undefined) {
      args.push("--body", input.body);
    }
    if (input.base) {
      args.push("--base", input.base);
    }
    if (input.draft) {
      args.push("--draft");
    }
    const result = await this.runWriteCommand(
      "pull-request-create",
      input.projectRoot,
      "gh",
      args
    );
    const url = result.stdout
      .split(LINE_BREAK_REGEX)
      .map((line) => line.trim())
      .find((line) => HTTPS_URL_REGEX.test(line));
    if (!url) {
      throw this.validationError(
        "GitHub CLI did not return a pull request URL",
        "pull-request-create"
      );
    }
    return {
      url,
      state: "open",
      ...(input.title ? { title: input.title } : {}),
    };
  }

  async runStackedAction(
    input: GitWorkflowRunInput,
    onProgress?: (event: GitWorkflowProgress) => void
  ): Promise<GitWorkflowRunResult> {
    let stage: GitWorkflowProgress["stage"] = "status";
    const progress = (status: GitWorkflowProgress["status"], message: string) =>
      onProgress?.({
        actionId: input.actionId,
        action: input.action,
        stage,
        status,
        message,
      });
    try {
      progress("running", "Checking repository status");
      const status = await this.getStatus(input.projectRoot);
      if (!status.isRepository) {
        throw this.validationError(
          "The selected project is not a Git repository",
          "status"
        );
      }
      progress("completed", "Repository status ready");

      let commitSha: string | undefined;
      let pushed = false;
      let pr: GitPullRequest | undefined;
      if (actionIncludesCommit(input.action)) {
        stage = "commit";
        progress("running", "Committing workspace changes");
        commitSha = (await this.commit(input)).commitSha;
        progress("completed", "Changes committed");
      }
      if (actionIncludesPush(input.action)) {
        stage = "push";
        progress("running", "Pushing branch to origin");
        await this.push(input);
        pushed = true;
        progress("completed", "Branch pushed");
      }
      if (actionIncludesPullRequest(input.action)) {
        stage = "pull_request";
        progress("running", "Creating GitHub pull request");
        pr = await this.createPullRequest(input);
        progress("completed", "Pull request created");
      }
      return {
        ...(commitSha ? { commitSha } : {}),
        pushed,
        ...(pr ? { pr } : {}),
      };
    } catch (error) {
      progress("failed", toError(error).message);
      throw error;
    }
  }

  async createWorktree(input: {
    projectRoot: string;
    worktreeId: string;
    branchName?: string;
  }): Promise<GitWorktree> {
    const projectRoot = await realpath(input.projectRoot);
    const status = await this.getStatus(projectRoot);
    if (!(status.isRepository && status.head)) {
      throw this.validationError(
        "A Git repository with at least one commit is required for worktree mode",
        "worktree-create"
      );
    }
    const branchName =
      input.branchName?.trim() ||
      `${WORKTREE_BRANCH_PREFIX}${sanitizeWorktreeId(input.worktreeId)}`;
    await this.runGit(
      ["check-ref-format", "--branch", branchName],
      projectRoot
    );
    const existing = (await this.listWorktrees({ projectRoot })).find(
      (worktree) => worktree.branchName === branchName
    );
    if (existing) {
      return existing;
    }

    const storageRoot = await this.storageRoot();
    const worktreeParent = path.resolve(
      storageRoot,
      "git-worktrees",
      stableWorktreeId(projectRoot)
    );
    const worktreePath = path.resolve(
      worktreeParent,
      sanitizeWorktreeId(input.worktreeId)
    );
    assertPathInside(worktreeParent, worktreePath);
    await mkdir(worktreeParent, { recursive: true });
    if (await pathExists(worktreePath)) {
      throw this.validationError(
        "The worktree destination already exists but is not registered",
        "worktree-create"
      );
    }
    const branchExists = await this.tryCommand(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      projectRoot
    );
    const args = branchExists
      ? ["worktree", "add", worktreePath, branchName]
      : ["worktree", "add", "-b", branchName, worktreePath, status.head];
    await this.runWrite("worktree-create", projectRoot, args);
    const created = (await this.listWorktrees({ projectRoot })).find(
      (worktree) => path.resolve(worktree.path) === worktreePath
    );
    if (!created) {
      throw this.validationError(
        "Git created the worktree but did not report it",
        "worktree-create"
      );
    }
    return created;
  }

  async listWorktrees(input: { projectRoot: string }): Promise<GitWorktree[]> {
    const result = await this.runGit(
      ["worktree", "list", "--porcelain"],
      input.projectRoot
    );
    return parseWorktreeList(result.stdout);
  }

  async removeWorktree(input: {
    projectRoot: string;
    worktreePath: string;
  }): Promise<void> {
    const storageRoot = await this.storageRoot();
    const allowedRoot = path.resolve(storageRoot, "git-worktrees");
    const worktreePath = path.resolve(input.worktreePath);
    assertPathInside(allowedRoot, worktreePath);
    await this.runWrite("worktree-remove", input.projectRoot, [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);
    await this.runWrite("worktree-prune", input.projectRoot, [
      "worktree",
      "prune",
    ]);
  }

  async getBranchDiff(input: {
    projectRoot: string;
    base?: string;
  }): Promise<string> {
    const status = await this.getStatus(input.projectRoot);
    if (!status.isRepository) {
      throw this.validationError(
        "The selected project is not a Git repository",
        "branch-diff"
      );
    }
    const base = input.base?.trim() || status.defaultRef;
    if (!base) {
      throw this.validationError(
        "A base branch is required for branch diff",
        "branch-diff"
      );
    }
    const remoteBase = status.hasPrimaryRemote
      ? await this.tryCommand(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${base}`],
          input.projectRoot
        )
      : undefined;
    const baseRef = remoteBase ? `origin/${base}` : base;
    return (
      await this.runGit(
        ["--no-pager", "diff", "--binary", `${baseRef}...HEAD`, "--"],
        input.projectRoot
      )
    ).stdout;
  }

  private async resolveDefaultRef(
    projectRoot: string,
    currentBranch?: string
  ): Promise<string | undefined> {
    const remoteHead = await this.tryCommand(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      projectRoot
    );
    const remoteRef = remoteHead?.stdout
      .trim()
      .replace(ORIGIN_PREFIX_REGEX, "");
    if (remoteRef) {
      return remoteRef;
    }
    for (const candidate of ["main", "master"]) {
      const exists = await this.tryCommand(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`],
        projectRoot
      );
      if (exists) {
        return candidate;
      }
    }
    const configured = await this.tryCommand(
      "git",
      ["config", "--get", "init.defaultBranch"],
      projectRoot
    );
    return configured?.stdout.trim() || currentBranch;
  }

  private async runGit(args: string[], cwd: string): Promise<CommandResult> {
    try {
      return await this.executeCommand("git", args, cwd);
    } catch (error) {
      throw this.commandError(error, args[0] ?? "git");
    }
  }

  private async tryCommand(
    command: string,
    args: string[],
    cwd: string
  ): Promise<CommandResult | undefined> {
    try {
      return await this.executeCommand(command, args, cwd);
    } catch {
      return undefined;
    }
  }

  private async runWrite(
    operation: string,
    cwd: string,
    args: string[]
  ): Promise<CommandResult> {
    return await this.runWriteCommand(operation, cwd, "git", args);
  }

  private async runWriteCommand(
    operation: string,
    cwd: string,
    command: string,
    args: string[]
  ): Promise<CommandResult> {
    logger.info("Git workflow write started", { projectRoot: cwd, operation });
    try {
      const result = await this.executeCommand(command, args, cwd);
      logger.info("Git workflow write completed", {
        projectRoot: cwd,
        operation,
      });
      return result;
    } catch (error) {
      const mapped = this.commandError(error, operation);
      logger.error("Git workflow write failed", mapped, {
        projectRoot: cwd,
        operation,
      });
      throw mapped;
    }
  }

  private commandError(error: unknown, operation: string): ValidationError {
    const commandError = toError(error) as Error & {
      stderr?: string;
      stdout?: string;
    };
    const detail = commandError.stderr?.trim() || commandError.stdout?.trim();
    return new ValidationError(
      detail || `Git workflow operation failed: ${operation}`,
      { module: "git", op: `git.workflow.${operation}`, cause: error }
    );
  }

  private validationError(message: string, operation: string): ValidationError {
    return new ValidationError(message, {
      module: "git",
      op: `git.workflow.${operation}`,
    });
  }
}

function actionIncludesCommit(action: GitWorkflowAction): boolean {
  return (
    action === "commit" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

function actionIncludesPush(action: GitWorkflowAction): boolean {
  return (
    action === "push" || action === "commit_push" || action === "commit_push_pr"
  );
}

function actionIncludesPullRequest(action: GitWorkflowAction): boolean {
  return action === "create_pr" || action === "commit_push_pr";
}

function parseWorktreeList(output: string): GitWorktree[] {
  return output
    .trim()
    .split(WORKTREE_BLOCK_BREAK_REGEX)
    .map((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split(LINE_BREAK_REGEX)) {
        const separator = line.indexOf(" ");
        fields.set(
          separator === -1 ? line : line.slice(0, separator),
          separator === -1 ? "" : line.slice(separator + 1)
        );
      }
      const worktreePath = fields.get("worktree");
      if (!worktreePath) {
        return undefined;
      }
      const branch = fields
        .get("branch")
        ?.replace(LOCAL_BRANCH_REF_PREFIX_REGEX, "");
      return {
        path: worktreePath,
        ...(fields.get("HEAD") ? { head: fields.get("HEAD") } : {}),
        ...(branch ? { branchName: branch } : {}),
        bare: fields.has("bare"),
        detached: fields.has("detached"),
      } satisfies GitWorktree;
    })
    .filter((item): item is GitWorktree => Boolean(item));
}

function sanitizeWorktreeId(value: string): string {
  const normalized = value
    .trim()
    .replace(SAFE_WORKTREE_ID_REGEX, "-")
    .replace(EDGE_DASH_REGEX, "");
  if (!normalized) {
    throw new ValidationError("Worktree id is invalid", {
      module: "git",
      op: "git.workflow.worktree-create",
    });
  }
  return normalized.slice(0, 80);
}

function stableWorktreeId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function assertPathInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    !(relative.startsWith("..") || path.isAbsolute(relative))
  ) {
    return;
  }
  throw new ValidationError("Worktree path escapes Eragear storage", {
    module: "git",
    op: "git.workflow.worktree-path",
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
