import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getStorageDirPath } from "#runtime/platform/storage/storage-path";
import type {
  CollectedWorkerPatch,
  PreparedWorkerWorkspace,
  WorkerWorkspacePort,
} from "../application/ports/worker-workspace.port";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const LEADING_CURRENT_DIR = /^\.\//;
const LINE_BREAK_PATTERN = /\r?\n/;
const TRAILING_SLASH = /\/$/;

export class WorkerWorkspacePolicyError extends Error {
  readonly code:
    | "DIRTY_PATH_OVERLAP"
    | "DIRECT_WORKSPACE_BUSY"
    | "NON_GIT_WRITE_UNSUPPORTED"
    | "BASELINE_HEAD_DRIFT"
    | "WORKSPACE_PATH_ESCAPE";

  constructor(code: WorkerWorkspacePolicyError["code"], message: string) {
    super(message);
    this.name = "WorkerWorkspacePolicyError";
    this.code = code;
  }
}

interface GitWorkerWorkspaceAdapterDeps {
  storageRoot?: () => Promise<string>;
}

export class GitWorkerWorkspaceAdapter implements WorkerWorkspacePort {
  private readonly storageRoot: () => Promise<string>;
  private readonly activeDirectWorkspaces = new Map<string, string>();

  constructor(deps: GitWorkerWorkspaceAdapterDeps = {}) {
    this.storageRoot = deps.storageRoot ?? getStorageDirPath;
  }

  async prepare(input: {
    runId: string;
    taskId: string;
    attemptKey: string;
    projectRoot: string;
    executionMode: "read_only" | "write";
    filesAllowed: string[];
    baseSnapshot: {
      head?: string;
      dirtyPaths: string[];
      targetFingerprints: Record<string, string>;
      capturedAt: string;
    };
  }): Promise<PreparedWorkerWorkspace> {
    const userProjectRoot = await realpath(input.projectRoot);
    const workspaceId = stableId(
      `${input.runId}:${input.taskId}:${input.attemptKey}`
    );
    if (input.executionMode === "read_only") {
      return {
        workspaceId,
        kind: "read_only",
        userProjectRoot,
        projectRoot: userProjectRoot,
        targetFingerprints: await this.fingerprint({
          projectRoot: userProjectRoot,
          relativePaths: input.filesAllowed,
        }),
      };
    }

    let head: string;
    let repositoryRoot: string;
    try {
      await runGit(userProjectRoot, ["rev-parse", "--is-inside-work-tree"]);
      head = (await runGit(userProjectRoot, ["rev-parse", "HEAD"])).trim();
      repositoryRoot = await realpath(
        (await runGit(userProjectRoot, ["rev-parse", "--show-toplevel"])).trim()
      );
    } catch {
      throw new WorkerWorkspacePolicyError(
        "NON_GIT_WRITE_UNSUPPORTED",
        "Automatic write workers require a Git-backed project"
      );
    }
    const preRef = directCheckpointRef(workspaceId, "pre");
    const claimedHere = this.claimDirectWorkspace(repositoryRoot, workspaceId);
    try {
      const existingCheckpoint = await resolveGitRef(repositoryRoot, preRef);
      if (existingCheckpoint) {
        head = existingCheckpoint;
      } else {
        if (
          input.baseSnapshot.head &&
          !(await isSupervisorOwnedDescendant(
            repositoryRoot,
            input.baseSnapshot.head,
            head
          ))
        ) {
          throw new WorkerWorkspacePolicyError(
            "BASELINE_HEAD_DRIFT",
            "Project HEAD changed after the run base snapshot"
          );
        }
        await runGit(repositoryRoot, ["add", "-A", "--", "."]);
        await runGit(repositoryRoot, [
          "commit",
          "--allow-empty",
          "-m",
          `supervisos: checkpoint before worker ${workspaceId.slice(0, 12)}`,
        ]);
        head = (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).trim();
        await runGit(repositoryRoot, ["update-ref", preRef, head]);
      }
      return {
        workspaceId,
        kind: "direct_git",
        userProjectRoot,
        projectRoot: userProjectRoot,
        repositoryRoot,
        baseHead: head,
        targetFingerprints: await this.fingerprint({
          projectRoot: userProjectRoot,
          relativePaths: input.filesAllowed,
        }),
      };
    } catch (error) {
      if (claimedHere) {
        this.releaseDirectWorkspace(repositoryRoot, workspaceId);
      }
      throw error;
    }
  }

  async claim(workspace: PreparedWorkerWorkspace): Promise<void> {
    if (workspace.kind !== "direct_git") {
      return;
    }
    const repositoryRoot = workspace.repositoryRoot
      ? await realpath(workspace.repositoryRoot)
      : await realpath(
          (
            await runGit(workspace.projectRoot, [
              "rev-parse",
              "--show-toplevel",
            ])
          ).trim()
        );
    this.claimDirectWorkspace(repositoryRoot, workspace.workspaceId);
  }

  private claimDirectWorkspace(
    repositoryRoot: string,
    workspaceId: string
  ): boolean {
    const repositoryKey = repositoryRoot.toLowerCase();
    const activeWorkspace = this.activeDirectWorkspaces.get(repositoryKey);
    if (activeWorkspace && activeWorkspace !== workspaceId) {
      throw new WorkerWorkspacePolicyError(
        "DIRECT_WORKSPACE_BUSY",
        "Another Supervisor worker is already writing to this Git repository"
      );
    }
    this.activeDirectWorkspaces.set(repositoryKey, workspaceId);
    return activeWorkspace !== workspaceId;
  }

  private releaseDirectWorkspace(
    repositoryRoot: string,
    workspaceId: string
  ): void {
    const repositoryKey = repositoryRoot.toLowerCase();
    if (this.activeDirectWorkspaces.get(repositoryKey) === workspaceId) {
      this.activeDirectWorkspaces.delete(repositoryKey);
    }
  }

  async collect(
    workspace: PreparedWorkerWorkspace
  ): Promise<CollectedWorkerPatch> {
    if (workspace.kind === "direct_git") {
      return await this.collectDirectWorkspace(workspace);
    }
    if (workspace.kind !== "isolated_git" || !workspace.baseHead) {
      throw new Error("Read-only workspaces do not produce patch artifacts");
    }
    await runGit(workspace.projectRoot, ["add", "-A", "--", "."]);
    const patchText = await runGit(workspace.projectRoot, [
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      workspace.baseHead,
      "--",
      ".",
    ]);
    const manifestOutput = await runGit(workspace.projectRoot, [
      "diff",
      "--cached",
      "--name-status",
      "-z",
      "-M",
      workspace.baseHead,
      "--",
      ".",
    ]);
    const userRepositoryRoot = await realpath(
      (
        await runGit(workspace.userProjectRoot, [
          "rev-parse",
          "--show-toplevel",
        ])
      ).trim()
    );
    const projectPrefix = normalizePath(
      path.relative(userRepositoryRoot, workspace.userProjectRoot)
    );
    const files = rebaseManifestToProjectRoot(
      parseNameStatus(manifestOutput),
      projectPrefix
    );
    const patchBytes = Buffer.from(patchText, "utf8");
    const sha256 = createHash("sha256").update(patchBytes).digest("hex");
    const storageRoot = await this.storageRoot();
    const artifactDir = path.resolve(storageRoot, "supervisor-artifacts");
    const storageRef = path.resolve(artifactDir, `${sha256}.patch`);
    assertPathInside(artifactDir, storageRef);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(storageRef, patchBytes);
    return {
      workspace,
      artifact: {
        artifactId: `patch-${sha256.slice(0, 24)}`,
        sha256,
        byteLength: patchBytes.byteLength,
        storageRef,
      },
      files,
    };
  }

  private async collectDirectWorkspace(
    workspace: PreparedWorkerWorkspace
  ): Promise<CollectedWorkerPatch> {
    if (!workspace.baseHead) {
      throw new Error("Direct Git workspace is missing its pre-worker commit");
    }
    const repositoryRoot = await realpath(
      workspace.repositoryRoot ??
        (
          await runGit(workspace.projectRoot, ["rev-parse", "--show-toplevel"])
        ).trim()
    );
    const postRef = directCheckpointRef(workspace.workspaceId, "post");
    let postHead = await resolveGitRef(repositoryRoot, postRef);
    let patchText: string;
    let manifestOutput: string;
    if (postHead) {
      patchText = await runGit(repositoryRoot, [
        "diff",
        "--binary",
        "--full-index",
        workspace.baseHead,
        postHead,
        "--",
        ".",
      ]);
      manifestOutput = await runGit(repositoryRoot, [
        "diff",
        "--name-status",
        "-z",
        "-M",
        workspace.baseHead,
        postHead,
        "--",
        ".",
      ]);
    } else {
      const currentHead = (
        await runGit(repositoryRoot, ["rev-parse", "HEAD"])
      ).trim();
      if (currentHead !== workspace.baseHead) {
        throw new WorkerWorkspacePolicyError(
          "BASELINE_HEAD_DRIFT",
          "Git HEAD changed while the direct worker was running"
        );
      }
      await runGit(repositoryRoot, ["add", "-A", "--", "."]);
      patchText = await runGit(repositoryRoot, [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        workspace.baseHead,
        "--",
        ".",
      ]);
      manifestOutput = await runGit(repositoryRoot, [
        "diff",
        "--cached",
        "--name-status",
        "-z",
        "-M",
        workspace.baseHead,
        "--",
        ".",
      ]);
      await runGit(repositoryRoot, [
        "commit",
        "--allow-empty",
        "-m",
        `supervisos: checkpoint after worker ${workspace.workspaceId.slice(0, 12)}`,
      ]);
      postHead = (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).trim();
      await runGit(repositoryRoot, ["update-ref", postRef, postHead]);
    }
    const projectPrefix = normalizePath(
      path.relative(repositoryRoot, workspace.userProjectRoot)
    );
    const files = rebaseManifestToProjectRoot(
      parseNameStatus(manifestOutput),
      projectPrefix
    );
    return await this.persistPatchArtifact(workspace, patchText, files);
  }

  private async persistPatchArtifact(
    workspace: PreparedWorkerWorkspace,
    patchText: string,
    files: CollectedWorkerPatch["files"]
  ): Promise<CollectedWorkerPatch> {
    const patchBytes = Buffer.from(patchText, "utf8");
    const sha256 = createHash("sha256").update(patchBytes).digest("hex");
    const storageRoot = await this.storageRoot();
    const artifactDir = path.resolve(storageRoot, "supervisor-artifacts");
    const storageRef = path.resolve(artifactDir, `${sha256}.patch`);
    assertPathInside(artifactDir, storageRef);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(storageRef, patchBytes);
    return {
      workspace,
      artifact: {
        artifactId: `patch-${sha256.slice(0, 24)}`,
        sha256,
        byteLength: patchBytes.byteLength,
        storageRef,
      },
      files,
    };
  }

  async apply(input: {
    workspace: PreparedWorkerWorkspace;
    artifact: {
      artifactId: string;
      sha256: string;
      byteLength: number;
      storageRef: string;
    };
  }): Promise<void> {
    if (input.workspace.kind === "read_only") {
      throw new Error("Read-only workspaces do not apply patches");
    }
    const patchBytes = await readFile(input.artifact.storageRef);
    const actualHash = createHash("sha256").update(patchBytes).digest("hex");
    if (
      actualHash !== input.artifact.sha256 ||
      patchBytes.byteLength !== input.artifact.byteLength
    ) {
      throw new Error("Worker patch artifact integrity check failed");
    }
    if (input.workspace.kind === "direct_git") {
      const repositoryRoot = await realpath(
        input.workspace.repositoryRoot ??
          (
            await runGit(input.workspace.projectRoot, [
              "rev-parse",
              "--show-toplevel",
            ])
          ).trim()
      );
      const postHead = await resolveGitRef(
        repositoryRoot,
        directCheckpointRef(input.workspace.workspaceId, "post")
      );
      const currentHead = (
        await runGit(repositoryRoot, ["rev-parse", "HEAD"])
      ).trim();
      if (!(postHead && postHead === currentHead)) {
        throw new WorkerWorkspacePolicyError(
          "BASELINE_HEAD_DRIFT",
          "Direct worker post-checkpoint is no longer the current HEAD"
        );
      }
      return;
    }
    await runGit(input.workspace.userProjectRoot, [
      "apply",
      "--binary",
      "--check",
      input.artifact.storageRef,
    ]);
    await runGit(input.workspace.userProjectRoot, [
      "apply",
      "--binary",
      input.artifact.storageRef,
    ]);
  }

  async fingerprint(input: {
    projectRoot: string;
    relativePaths: string[];
  }): Promise<Record<string, string>> {
    const root = await realpath(input.projectRoot);
    const result: Record<string, string> = {};
    for (const relativePath of input.relativePaths) {
      const target = path.resolve(root, relativePath);
      assertPathInside(root, target);
      result[normalizePath(relativePath)] = await fingerprintPath(target);
    }
    return result;
  }

  async dispose(workspace: PreparedWorkerWorkspace): Promise<void> {
    if (workspace.kind === "read_only") {
      return;
    }
    if (workspace.kind === "direct_git") {
      const repositoryRoot = workspace.repositoryRoot
        ? await realpath(workspace.repositoryRoot)
        : await realpath(
            (
              await runGit(workspace.projectRoot, [
                "rev-parse",
                "--show-toplevel",
              ])
            ).trim()
          );
      this.releaseDirectWorkspace(repositoryRoot, workspace.workspaceId);
      return;
    }
    const storageRoot = await this.storageRoot();
    const allowedRoot = path.resolve(storageRoot, "supervisor-worktrees");
    const gitWorktreeRoot =
      workspace.gitWorktreeRoot ??
      (await realpath(
        (
          await runGit(workspace.projectRoot, ["rev-parse", "--show-toplevel"])
        ).trim()
      ));
    assertPathInside(allowedRoot, gitWorktreeRoot);
    await runGit(workspace.userProjectRoot, [
      "worktree",
      "remove",
      "--force",
      gitWorktreeRoot,
    ]).catch(() => undefined);
    await rm(gitWorktreeRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await runGit(workspace.userProjectRoot, ["worktree", "prune"]);
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return stdout;
}

function parseNameStatus(output: string) {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const touched: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = normalizePath(tokens[index++] ?? "");
      const to = normalizePath(tokens[index++] ?? "");
      renamed.push({ from, to });
      touched.push(from, to);
      continue;
    }
    const filePath = normalizePath(tokens[index++] ?? "");
    if (!filePath) {
      continue;
    }
    touched.push(filePath);
    if (status.startsWith("A")) {
      created.push(filePath);
    } else if (status.startsWith("D")) {
      deleted.push(filePath);
    }
  }
  return {
    touched: uniqueSorted(touched),
    created: uniqueSorted(created),
    deleted: uniqueSorted(deleted),
    renamed: renamed.sort((left, right) => left.from.localeCompare(right.from)),
  };
}

function rebaseManifestToProjectRoot(
  manifest: ReturnType<typeof parseNameStatus>,
  projectPrefix: string
): ReturnType<typeof parseNameStatus> {
  const rebase = (filePath: string) =>
    rebaseGitPathToProject(filePath, projectPrefix) ??
    `../${normalizePath(filePath)}`;
  return {
    touched: uniqueSorted(manifest.touched.map(rebase)),
    created: uniqueSorted(manifest.created.map(rebase)),
    deleted: uniqueSorted(manifest.deleted.map(rebase)),
    renamed: manifest.renamed
      .map((item) => ({ from: rebase(item.from), to: rebase(item.to) }))
      .sort((left, right) => left.from.localeCompare(right.from)),
  };
}

function rebaseGitPathToProject(
  filePath: string,
  projectPrefix: string
): string | undefined {
  const normalizedPath = normalizePath(filePath);
  const normalizedPrefix = normalizePath(projectPrefix).replace(
    TRAILING_SLASH,
    ""
  );
  if (!normalizedPrefix) {
    return normalizedPath;
  }
  if (!normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    return undefined;
  }
  return normalizedPath.slice(normalizedPrefix.length + 1);
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(LEADING_CURRENT_DIR, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function isSupervisorOwnedDescendant(
  repositoryRoot: string,
  expectedHead: string,
  currentHead: string
): Promise<boolean> {
  let resolvedExpectedHead: string;
  try {
    resolvedExpectedHead = (
      await runGit(repositoryRoot, [
        "rev-parse",
        "--verify",
        `${expectedHead}^{commit}`,
      ])
    ).trim();
  } catch {
    return false;
  }
  if (resolvedExpectedHead === currentHead) {
    return true;
  }
  const expectedIsAncestor = await runGit(repositoryRoot, [
    "merge-base",
    "--is-ancestor",
    resolvedExpectedHead,
    currentHead,
  ]).then(
    () => true,
    () => false
  );
  if (!expectedIsAncestor) {
    return false;
  }
  const interveningCommits = (
    await runGit(repositoryRoot, [
      "rev-list",
      "--reverse",
      `${resolvedExpectedHead}..${currentHead}`,
    ])
  )
    .split(LINE_BREAK_PATTERN)
    .map((commit) => commit.trim())
    .filter(Boolean);
  for (const commit of interveningCommits) {
    const subject = (
      await runGit(repositoryRoot, ["show", "-s", "--format=%s", commit])
    ).trim();
    if (subject.startsWith("supervisos: checkpoint ")) {
      continue;
    }
    if (!subject.startsWith("supervisos: ")) {
      return false;
    }
    const changedPaths = (
      await runGit(repositoryRoot, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        commit,
      ])
    ).trim();
    if (changedPaths) {
      return false;
    }
  }
  return true;
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function assertPathInside(root: string, target: string): void {
  const relativePath = path.relative(path.resolve(root), path.resolve(target));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new WorkerWorkspacePolicyError(
      "WORKSPACE_PATH_ESCAPE",
      `Workspace path escaped runtime storage: ${target}`
    );
  }
}

async function fingerprintPath(target: string): Promise<string> {
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      return createHash("sha256").update("directory").digest("hex");
    }
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  } catch {
    return createHash("sha256").update("missing").digest("hex");
  }
}

function directCheckpointRef(
  workspaceId: string,
  phase: "pre" | "post"
): string {
  return `refs/eragear/supervisor-direct-${workspaceId}-${phase}`;
}

async function resolveGitRef(
  repositoryRoot: string,
  ref: string
): Promise<string | undefined> {
  try {
    return (
      await runGit(repositoryRoot, ["rev-parse", "--verify", `${ref}^{commit}`])
    ).trim();
  } catch {
    return undefined;
  }
}

export const __gitWorkerWorkspaceInternals = {
  parseNameStatus,
  pathsOverlap,
  rebaseManifestToProjectRoot,
};
