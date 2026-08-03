import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
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

export class WorkerWorkspacePolicyError extends Error {
  readonly code:
    | "DIRTY_PATH_OVERLAP"
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

    const dirtyOverlap = input.baseSnapshot.dirtyPaths.filter((dirtyPath) =>
      input.filesAllowed.some((allowedPath) =>
        pathsOverlap(dirtyPath, allowedPath)
      )
    );
    if (dirtyOverlap.length > 0) {
      throw new WorkerWorkspacePolicyError(
        "DIRTY_PATH_OVERLAP",
        `Write task overlaps dirty user paths: ${dirtyOverlap.join(", ")}`
      );
    }

    let head: string;
    try {
      await runGit(userProjectRoot, ["rev-parse", "--is-inside-work-tree"]);
      head = (await runGit(userProjectRoot, ["rev-parse", "HEAD"])).trim();
    } catch {
      throw new WorkerWorkspacePolicyError(
        "NON_GIT_WRITE_UNSUPPORTED",
        "Automatic write workers require a Git-backed project"
      );
    }
    if (
      input.baseSnapshot.head &&
      !(
        head.startsWith(input.baseSnapshot.head) ||
        input.baseSnapshot.head.startsWith(head)
      )
    ) {
      throw new WorkerWorkspacePolicyError(
        "BASELINE_HEAD_DRIFT",
        "Project HEAD changed after the run base snapshot"
      );
    }

    const storageRoot = await this.storageRoot();
    const workspaceParent = path.resolve(
      storageRoot,
      "supervisor-worktrees",
      stableId(input.runId)
    );
    const workspaceRoot = path.resolve(workspaceParent, workspaceId);
    assertPathInside(workspaceParent, workspaceRoot);
    await mkdir(workspaceParent, { recursive: true });
    if (!(await pathExists(path.join(workspaceRoot, ".git")))) {
      await runGit(userProjectRoot, [
        "worktree",
        "add",
        "--detach",
        workspaceRoot,
        head,
      ]);
    }
    return {
      workspaceId,
      kind: "isolated_git",
      userProjectRoot,
      projectRoot: await realpath(workspaceRoot),
      baseHead: head,
      targetFingerprints: await this.fingerprint({
        projectRoot: userProjectRoot,
        relativePaths: input.filesAllowed,
      }),
    };
  }

  async collect(
    workspace: PreparedWorkerWorkspace
  ): Promise<CollectedWorkerPatch> {
    if (workspace.kind !== "isolated_git" || !workspace.baseHead) {
      throw new Error("Read-only workspaces do not produce patch artifacts");
    }
    await runGit(workspace.projectRoot, ["add", "-A"]);
    const patchText = await runGit(workspace.projectRoot, [
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      workspace.baseHead,
      "--",
    ]);
    const manifestOutput = await runGit(workspace.projectRoot, [
      "diff",
      "--cached",
      "--name-status",
      "-z",
      "-M",
      workspace.baseHead,
      "--",
    ]);
    const files = parseNameStatus(manifestOutput);
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
    if (input.workspace.kind !== "isolated_git") {
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
    const storageRoot = await this.storageRoot();
    const allowedRoot = path.resolve(storageRoot, "supervisor-worktrees");
    assertPathInside(allowedRoot, workspace.projectRoot);
    await runGit(workspace.userProjectRoot, [
      "worktree",
      "remove",
      "--force",
      workspace.projectRoot,
    ]).catch(() => undefined);
    await rm(workspace.projectRoot, { recursive: true, force: true });
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export const __gitWorkerWorkspaceInternals = {
  parseNameStatus,
  pathsOverlap,
};
