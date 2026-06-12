/**
 * Git Adapter
 *
 * Implements git operations for code context and project analysis.
 * Provides methods for getting project context, diffs, and reading files.
 *
 * @module infra/git
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  GitChangedFile,
  GitCheckpoint,
  GitCheckpointCreateParams,
  GitCheckpointPort,
  GitCheckpointRestoreParams,
  GitCheckpointRestorePortResult,
  GitFileStatus,
  GitRepositoryPort,
  GitRepositoryReadResult,
} from "@/modules/git";
import type { GitPort } from "@/modules/tooling";
import { createLogger } from "@/platform/logging/structured-logger";
import { isNodeErrno } from "@/shared/utils/node-error.util";

const execFileAsync = promisify(execFile);
const logger = createLogger("Storage");
const GIT_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const EMPTY_DIFF_FILE_PREFIX = "eragear-git-empty-diff-";
const PROJECT_CONTEXT_EXCLUDED_DIR_NAMES = new Set([".git"]);
const PROJECT_DATA_DIR_NAME = ".eragear";
const CHECKPOINT_DIR_NAME = "checkpoints";
const CHECKPOINT_ID_REGEX = /^checkpoint-[0-9a-f-]{36}$/i;
const LINE_BREAK_REGEX = /\r?\n/;
const GIT_BRANCH_TRACKING_REGEX = /^([^\s[]+)(?:\s+\[(.+)\])?$/;

interface ExecFileFailure extends Error {
  code?: number | string | null;
  stdout?: string;
}

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeErrno(error, "ENOENT") || isNodeErrno(error, "ENOTDIR");
}

async function runGitCommand(params: {
  cwd: string;
  args: string[];
  maxBuffer?: number;
}): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", params.args, {
    cwd: params.cwd,
    maxBuffer: params.maxBuffer ?? GIT_EXEC_MAX_BUFFER_BYTES,
  });
}

function normalizePortablePath(pathValue: string): string {
  return pathValue.split(sep).join("/");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: File scanning requires complex directory traversal logic
async function scanProjectFiles(scanRoot: string): Promise<{
  files: string[];
  projectRules: { path: string; location: string }[];
}> {
  const files: string[] = [];
  const projectRules: { path: string; location: string }[] = [];
  const pendingDirs: string[] = [scanRoot];

  while (pendingDirs.length > 0) {
    const dir = pendingDirs.pop();
    if (!dir) {
      continue;
    }

    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch (scanError) {
      logger.warn("Failed to scan project directory for file tree snapshot", {
        scanRoot,
        dir,
        error:
          scanError instanceof Error ? scanError.message : String(scanError),
      });
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = normalizePortablePath(relative(scanRoot, fullPath));
      if (!relPath || relPath === ".") {
        continue;
      }

      if (entry.isDirectory()) {
        if (PROJECT_CONTEXT_EXCLUDED_DIR_NAMES.has(entry.name)) {
          continue;
        }
        pendingDirs.push(fullPath);
        continue;
      }

      files.push(relPath);
      if (entry.name.endsWith(".mdc")) {
        const location = dirname(relPath);
        projectRules.push({
          path: relPath,
          location: location === "." ? "." : location,
        });
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  projectRules.sort((a, b) => a.path.localeCompare(b.path));

  return { files, projectRules };
}

/**
 * GitAdapter - Implements git operations for project context
 */
export class GitAdapter
  implements GitPort, GitRepositoryPort, GitCheckpointPort
{
  async getRepositoryState(
    projectRoot: string
  ): Promise<GitRepositoryReadResult> {
    try {
      await runGitCommand({
        cwd: projectRoot,
        args: ["rev-parse", "--is-inside-work-tree"],
      });
    } catch {
      return {
        isRepository: false,
        ahead: 0,
        behind: 0,
        changedFiles: [],
        error: "Project root is not a Git repository or Git is unavailable.",
      };
    }

    try {
      const [{ stdout: statusOutput }, headResult] = await Promise.all([
        runGitCommand({
          cwd: projectRoot,
          args: [
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=all",
          ],
        }),
        runGitCommand({
          cwd: projectRoot,
          args: ["rev-parse", "--short", "HEAD"],
        }).catch(() => ({ stdout: "", stderr: "" })),
      ]);
      const parsedStatus = parseGitStatusPorcelain(statusOutput);

      return {
        isRepository: true,
        branch: parsedStatus.branch,
        head: headResult.stdout.trim() || undefined,
        upstream: parsedStatus.upstream,
        ahead: parsedStatus.ahead,
        behind: parsedStatus.behind,
        changedFiles: parsedStatus.changedFiles,
      };
    } catch (error) {
      logger.warn("Failed to read git repository state", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        isRepository: true,
        ahead: 0,
        behind: 0,
        changedFiles: [],
        error: "Failed to read Git repository state.",
      };
    }
  }

  async createCheckpoint(
    params: GitCheckpointCreateParams
  ): Promise<GitCheckpoint> {
    const projectRoot = await assertGitRepository(params.projectRoot);
    const checkpoint = await buildGitCheckpoint(projectRoot, params);
    await writeCheckpoint(projectRoot, checkpoint);
    return checkpoint;
  }

  async listCheckpoints(params: {
    projectRoot: string;
    limit?: number;
  }): Promise<GitCheckpoint[]> {
    const projectRoot = await realpath(params.projectRoot);
    const checkpointDir = getCheckpointDir(projectRoot);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(checkpointDir, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }
      throw error;
    }

    const checkpoints = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const metadataPath = join(checkpointDir, entry.name);
          try {
            return normalizeCheckpoint(
              JSON.parse(await readFile(metadataPath, "utf8")),
              projectRoot
            );
          } catch (error) {
            logger.warn("Failed to read git checkpoint metadata", {
              projectRoot,
              metadataPath,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        })
    );

    const limit = Math.max(1, Math.trunc(params.limit ?? 20));
    return checkpoints
      .filter((checkpoint): checkpoint is GitCheckpoint => checkpoint !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async restoreCheckpoint(
    params: GitCheckpointRestoreParams
  ): Promise<GitCheckpointRestorePortResult> {
    const projectRoot = await assertGitRepository(params.projectRoot);
    assertSafeCheckpointId(params.checkpointId);
    const checkpoint = await readCheckpoint(projectRoot, params.checkpointId);
    if (!checkpoint.canRestore || checkpoint.patchBytes <= 0) {
      throw new Error(`Checkpoint cannot be restored: ${params.checkpointId}`);
    }

    const safetyParams: GitCheckpointCreateParams = {
      projectRoot,
      name: `Safety before restore: ${checkpoint.name}`,
      kind: "safety",
    };
    if (checkpoint.projectId) {
      safetyParams.projectId = checkpoint.projectId;
    }
    if (checkpoint.projectName) {
      safetyParams.projectName = checkpoint.projectName;
    }
    if (checkpoint.chatId) {
      safetyParams.chatId = checkpoint.chatId;
    }
    if (checkpoint.agentSessionId) {
      safetyParams.agentSessionId = checkpoint.agentSessionId;
    }
    if (checkpoint.turnId) {
      safetyParams.turnId = checkpoint.turnId;
    }
    const safetyCheckpoint = await buildGitCheckpoint(
      projectRoot,
      safetyParams
    );
    await writeCheckpoint(projectRoot, safetyCheckpoint);

    const patchPath = getCheckpointPatchPath(projectRoot, checkpoint.id);
    await runGitCommand({
      cwd: projectRoot,
      args: ["apply", "-R", "--check", "--whitespace=nowarn", patchPath],
    });
    await runGitCommand({
      cwd: projectRoot,
      args: ["apply", "-R", "--whitespace=nowarn", patchPath],
    });

    const restoredAt = new Date().toISOString();
    const restoredCheckpoint: GitCheckpoint = {
      ...checkpoint,
      restoredAt,
      canRestore: false,
      diagnostics: [
        `Checkpoint restored by reverse patch at ${restoredAt}.`,
        ...(safetyCheckpoint.patchBytes > 0
          ? [`Pre-restore safety checkpoint created: ${safetyCheckpoint.id}.`]
          : ["Pre-restore safety checkpoint was empty."]),
        ...checkpoint.diagnostics,
      ],
    };
    await writeCheckpoint(projectRoot, restoredCheckpoint);

    return {
      checkpoint: restoredCheckpoint,
      ...(safetyCheckpoint.patchBytes > 0 ? { safetyCheckpoint } : {}),
      restoredAt,
    };
  }

  /**
   * Gets project context including filesystem files, project rules, and active tabs
   *
   * @param scanRoot - The root directory to scan
   * @returns Project context object with files, rules, and active tabs
   */
  async getProjectContext(scanRoot: string) {
    const activeTabs: { path: string }[] = [];
    const { files, projectRules } = await scanProjectFiles(scanRoot);

    return {
      projectRules,
      activeTabs,
      files,
    };
  }

  /**
   * Gets the current git diff including staged, unstaged, and untracked files
   *
   * @param projectRoot - The project root directory
   * @returns Combined diff as a string
   * @throws Error if git operations fail
   */
  async getDiff(projectRoot: string): Promise<string> {
    try {
      let combinedPatch = "";

      // Get diff for tracked changes
      try {
        const { stdout } = await runGitCommand({
          cwd: projectRoot,
          args: ["diff", "HEAD"],
        });
        combinedPatch += stdout;
      } catch {
        // Ignore missing HEAD
      }

      // Get diff for untracked files
      const { stdout: untrackedFilesOutput } = await runGitCommand({
        cwd: projectRoot,
        args: ["ls-files", "--others", "--exclude-standard"],
      });
      const untrackedFiles = untrackedFilesOutput
        .split("\n")
        .filter((filePath) => filePath.trim().length > 0);

      const tempDir = await mkdtemp(join(tmpdir(), EMPTY_DIFF_FILE_PREFIX));
      const emptyFilePath = join(tempDir, "empty.txt");
      await writeFile(emptyFilePath, "", "utf8");
      try {
        for (const filePath of untrackedFiles) {
          try {
            await runGitCommand({
              cwd: projectRoot,
              args: [
                "--no-pager",
                "diff",
                "--no-index",
                "--src-prefix",
                "a/dev/null/",
                "--dst-prefix",
                "b/",
                "--",
                emptyFilePath,
                filePath,
              ],
            });
          } catch (error) {
            const execError = error as ExecFileFailure;
            if (execError.stdout) {
              combinedPatch += `\n${execError.stdout}`;
              continue;
            }
            if (execError.code === 1) {
              continue;
            }
            throw error;
          }
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      return combinedPatch;
    } catch (error) {
      logger.error("Failed to get git diff", error as Error, { projectRoot });
      throw new Error("Failed to get changes. Is this a git repository?");
    }
  }

  /**
   * Reads a file within the project root with path traversal protection
   *
   * @param projectRoot - The project root directory
   * @param relativePath - The relative path to the file
   * @returns The file contents as a string
   * @throws Error if path is outside project root or file cannot be read
   */
  async readFileWithinRoot(
    projectRoot: string,
    relativePath: string
  ): Promise<string> {
    if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
      throw new Error("Access denied: Path is required");
    }
    if (isAbsolute(relativePath)) {
      throw new Error("Access denied: Path must be relative to project root");
    }
    const canonicalRoot = await realpath(projectRoot);
    const resolvedPath = resolve(canonicalRoot, relativePath);
    if (isPathOutsideRoot(canonicalRoot, resolvedPath)) {
      throw new Error("Access denied: Path outside project root");
    }
    let canonicalTargetPath = resolvedPath;
    try {
      canonicalTargetPath = await realpath(resolvedPath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    if (isPathOutsideRoot(canonicalRoot, canonicalTargetPath)) {
      throw new Error("Access denied: Path outside project root");
    }

    try {
      return await readFile(canonicalTargetPath, "utf8");
    } catch (error) {
      logger.error("Failed to read file within project root", error as Error, {
        fullPath: canonicalTargetPath,
      });
      throw new Error(`Failed to read file: ${error}`);
    }
  }
}

async function assertGitRepository(projectRoot: string): Promise<string> {
  const canonicalRoot = await realpath(projectRoot);
  await runGitCommand({
    cwd: canonicalRoot,
    args: ["rev-parse", "--is-inside-work-tree"],
  });
  return canonicalRoot;
}

async function buildGitCheckpoint(
  projectRoot: string,
  params: GitCheckpointCreateParams
): Promise<GitCheckpoint> {
  const id = `checkpoint-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const diagnostics: string[] = [];
  let gitHead: string | undefined;
  let statusLines: string[] = [];
  let changedFiles: GitChangedFile[] = [];
  let patch = "";

  try {
    gitHead = (
      await runGitCommand({
        cwd: projectRoot,
        args: ["rev-parse", "HEAD"],
      })
    ).stdout.trim();
  } catch (error) {
    diagnostics.push(
      `Git HEAD capture failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    statusLines = (
      await runGitCommand({
        cwd: projectRoot,
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
      })
    ).stdout
      .split(LINE_BREAK_REGEX)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .filter((line) => !isCheckpointInternalStatusLine(line));
    changedFiles = statusLines
      .map(parseStatusLine)
      .filter((file): file is GitChangedFile => file !== null);
  } catch (error) {
    diagnostics.push(
      `Git status capture failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    patch = (
      await runGitCommand({
        cwd: projectRoot,
        args: ["diff", "--binary", "HEAD", "--"],
      })
    ).stdout;
  } catch {
    patch = (
      await runGitCommand({
        cwd: projectRoot,
        args: ["diff", "--binary", "--"],
      })
    ).stdout;
  }

  if (changedFiles.some((file) => file.status === "untracked")) {
    diagnostics.push(
      "Untracked files are listed in checkpoint metadata but are not embedded in the tracked-file patch."
    );
  }
  if (!patch.trim()) {
    diagnostics.push(
      "No tracked-file diff was present when the checkpoint was created."
    );
  }

  await ensureCheckpointDir(projectRoot);
  await writeFile(getCheckpointPatchPath(projectRoot, id), patch, "utf8");
  const patchBytes = Buffer.byteLength(patch, "utf8");

  const checkpoint: GitCheckpoint = {
    id,
    name: params.name?.trim() || defaultCheckpointName(params.kind, createdAt),
    kind: params.kind,
    projectRoot,
    createdAt,
    changedFiles: changedFiles.sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    statusLines,
    patchBytes,
    canRestore: patchBytes > 0,
    diagnostics,
  };
  if (params.projectId) {
    checkpoint.projectId = params.projectId;
  }
  if (params.projectName) {
    checkpoint.projectName = params.projectName;
  }
  if (params.chatId) {
    checkpoint.chatId = params.chatId;
  }
  if (params.agentSessionId) {
    checkpoint.agentSessionId = params.agentSessionId;
  }
  if (params.turnId) {
    checkpoint.turnId = params.turnId;
  }
  if (gitHead) {
    checkpoint.gitHead = gitHead;
  }
  return checkpoint;
}

function defaultCheckpointName(
  kind: GitCheckpoint["kind"],
  createdAt: string
): string {
  const label = new Date(createdAt).toLocaleString("en-US", {
    hour12: false,
  });
  switch (kind) {
    case "auto":
      return `Agent turn checkpoint ${label}`;
    case "safety":
      return `Safety checkpoint ${label}`;
    default:
      return `Checkpoint ${label}`;
  }
}

async function writeCheckpoint(
  projectRoot: string,
  checkpoint: GitCheckpoint
): Promise<void> {
  await ensureCheckpointDir(projectRoot);
  await writeFile(
    getCheckpointMetadataPath(projectRoot, checkpoint.id),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8"
  );
}

async function readCheckpoint(
  projectRoot: string,
  checkpointId: string
): Promise<GitCheckpoint> {
  assertSafeCheckpointId(checkpointId);
  return normalizeCheckpoint(
    JSON.parse(
      await readFile(
        getCheckpointMetadataPath(projectRoot, checkpointId),
        "utf8"
      )
    ),
    projectRoot
  );
}

function normalizeCheckpoint(
  input: unknown,
  projectRoot: string
): GitCheckpoint {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid checkpoint metadata");
  }
  const value = input as Partial<GitCheckpoint>;
  if (!value.id || typeof value.id !== "string") {
    throw new Error("Invalid checkpoint id");
  }
  assertSafeCheckpointId(value.id);
  const checkpoint: GitCheckpoint = {
    id: value.id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : `Checkpoint ${value.id}`,
    kind:
      value.kind === "auto" || value.kind === "safety" ? value.kind : "manual",
    projectRoot,
    createdAt:
      typeof value.createdAt === "string"
        ? value.createdAt
        : new Date(0).toISOString(),
    changedFiles: Array.isArray(value.changedFiles)
      ? value.changedFiles.filter(isGitChangedFile)
      : [],
    statusLines: Array.isArray(value.statusLines)
      ? value.statusLines.filter(
          (line): line is string => typeof line === "string"
        )
      : [],
    patchBytes:
      typeof value.patchBytes === "number" && Number.isFinite(value.patchBytes)
        ? Math.max(0, Math.trunc(value.patchBytes))
        : 0,
    canRestore: Boolean(value.canRestore),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.filter(
          (diagnostic): diagnostic is string => typeof diagnostic === "string"
        )
      : [],
  };
  if (typeof value.projectId === "string") {
    checkpoint.projectId = value.projectId;
  }
  if (typeof value.projectName === "string") {
    checkpoint.projectName = value.projectName;
  }
  if (typeof value.restoredAt === "string") {
    checkpoint.restoredAt = value.restoredAt;
  }
  if (typeof value.chatId === "string") {
    checkpoint.chatId = value.chatId;
  }
  if (typeof value.agentSessionId === "string") {
    checkpoint.agentSessionId = value.agentSessionId;
  }
  if (typeof value.turnId === "string") {
    checkpoint.turnId = value.turnId;
  }
  if (typeof value.gitHead === "string") {
    checkpoint.gitHead = value.gitHead;
  }
  return checkpoint;
}

function isGitChangedFile(value: unknown): value is GitChangedFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as Partial<GitChangedFile>;
  return (
    typeof file.path === "string" &&
    typeof file.status === "string" &&
    typeof file.staged === "boolean" &&
    typeof file.unstaged === "boolean"
  );
}

async function ensureCheckpointDir(projectRoot: string): Promise<string> {
  const checkpointDir = getCheckpointDir(projectRoot);
  if (isPathOutsideRoot(projectRoot, checkpointDir)) {
    throw new Error("Checkpoint directory escaped project root");
  }
  await mkdir(checkpointDir, { recursive: true });
  return checkpointDir;
}

function getCheckpointDir(projectRoot: string): string {
  return resolve(projectRoot, PROJECT_DATA_DIR_NAME, CHECKPOINT_DIR_NAME);
}

function getCheckpointMetadataPath(
  projectRoot: string,
  checkpointId: string
): string {
  assertSafeCheckpointId(checkpointId);
  return resolve(getCheckpointDir(projectRoot), `${checkpointId}.json`);
}

function getCheckpointPatchPath(
  projectRoot: string,
  checkpointId: string
): string {
  assertSafeCheckpointId(checkpointId);
  return resolve(getCheckpointDir(projectRoot), `${checkpointId}.patch`);
}

function assertSafeCheckpointId(checkpointId: string): void {
  if (!CHECKPOINT_ID_REGEX.test(checkpointId)) {
    throw new Error(`Invalid checkpoint id: ${checkpointId}`);
  }
}

function isCheckpointInternalStatusLine(line: string): boolean {
  const pathText = line.slice(3).trim();
  return pathText.startsWith(
    `${PROJECT_DATA_DIR_NAME}/${CHECKPOINT_DIR_NAME}/`
  );
}

function parseGitStatusPorcelain(output: string): {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: GitChangedFile[];
} {
  const lines = output
    .split(LINE_BREAK_REGEX)
    .filter((line) => line.length > 0);
  const header = lines.find((line) => line.startsWith("## "));
  const branchState = header ? parseBranchHeader(header) : {};
  const changedFiles = lines
    .filter((line) => !line.startsWith("## "))
    .map(parseStatusLine)
    .filter((file): file is GitChangedFile => file !== null)
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    branch: branchState.branch,
    upstream: branchState.upstream,
    ahead: branchState.ahead ?? 0,
    behind: branchState.behind ?? 0,
    changedFiles,
  };
}

function parseBranchHeader(header: string): {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
} {
  const content = header.slice(3).trim();
  if (content.length === 0) {
    return {};
  }

  const [branchSegment, trackingSegment] = content.split("...");
  const branch = normalizeBranchName(branchSegment);
  if (!trackingSegment) {
    return { branch };
  }

  const trackingMatch = GIT_BRANCH_TRACKING_REGEX.exec(trackingSegment);
  const upstream = trackingMatch?.[1];
  const trackingDetails = trackingMatch?.[2] ?? "";

  return {
    branch,
    upstream,
    ahead: readTrackingCount(trackingDetails, "ahead"),
    behind: readTrackingCount(trackingDetails, "behind"),
  };
}

function normalizeBranchName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("No commits yet on ")) {
    return trimmed.slice("No commits yet on ".length).trim() || undefined;
  }
  if (trimmed === "HEAD (no branch)") {
    return "detached";
  }
  return trimmed;
}

function readTrackingCount(details: string, key: "ahead" | "behind"): number {
  const match = new RegExp(`${key} (\\d+)`).exec(details);
  const value = match?.[1] ? Number(match[1]) : 0;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseStatusLine(line: string): GitChangedFile | null {
  if (line.length < 4) {
    return null;
  }

  const indexStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  if (indexStatus === "!" && worktreeStatus === "!") {
    return null;
  }

  const rawPath = line.slice(3).trim();
  if (!rawPath) {
    return null;
  }

  const renameSeparator = " -> ";
  const renameIndex = rawPath.indexOf(renameSeparator);
  const oldPath =
    renameIndex >= 0 ? rawPath.slice(0, renameIndex).trim() : undefined;
  const filePath =
    renameIndex >= 0
      ? rawPath.slice(renameIndex + renameSeparator.length).trim()
      : rawPath;

  return {
    path: unquoteGitPath(filePath),
    oldPath: oldPath ? unquoteGitPath(oldPath) : undefined,
    status: getGitFileStatus(indexStatus, worktreeStatus),
    staged: isStagedStatus(indexStatus),
    unstaged: isUnstagedStatus(indexStatus, worktreeStatus),
  };
}

function getGitFileStatus(
  indexStatus: string,
  worktreeStatus: string
): GitFileStatus {
  if (indexStatus === "?" && worktreeStatus === "?") {
    return "untracked";
  }
  if (
    indexStatus === "U" ||
    worktreeStatus === "U" ||
    (indexStatus === "A" && worktreeStatus === "A") ||
    (indexStatus === "D" && worktreeStatus === "D")
  ) {
    return "conflicted";
  }
  const effectiveStatus =
    indexStatus !== " " && indexStatus !== "?" ? indexStatus : worktreeStatus;
  switch (effectiveStatus) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "unknown";
  }
}

function isStagedStatus(status: string): boolean {
  return status !== " " && status !== "?" && status !== "!";
}

function isUnstagedStatus(
  indexStatus: string,
  worktreeStatus: string
): boolean {
  if (indexStatus === "?" && worktreeStatus === "?") {
    return true;
  }
  return (
    worktreeStatus !== " " && worktreeStatus !== "?" && worktreeStatus !== "!"
  );
}

function unquoteGitPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}
