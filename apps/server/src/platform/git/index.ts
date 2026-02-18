/**
 * Git Adapter
 *
 * Implements git operations for code context and project analysis.
 * Provides methods for getting project context, diffs, and reading files.
 * Falls back to filesystem scanning when git is unavailable.
 *
 * @module infra/git
 */

import { execFile } from "node:child_process";
import {
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
import type { GitPort } from "@/modules/tooling";
import { createLogger } from "@/platform/logging/structured-logger";

const execFileAsync = promisify(execFile);
const logger = createLogger("Storage");
const GIT_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const EMPTY_DIFF_FILE_PREFIX = "eragear-git-empty-diff-";

interface ExecFileFailure extends Error {
  code?: number | string | null;
  stdout?: string;
}

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
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

/**
 * Recursively scans a directory for files
 *
 * @param dir - Current directory to scan
 * @param base - Base directory for relative paths
 * @param depth - Current recursion depth
 * @param files - Array to collect file paths
 * @param projectRules - Array to collect .mdc rule files
 */
async function scanDirRecursive(
  dir: string,
  base: string,
  depth: number,
  files: string[],
  projectRules: { path: string; location: string }[]
): Promise<void> {
  if (depth > 10) {
    return;
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(base, fullPath);

      if (entry.isDirectory()) {
        await scanDirRecursive(fullPath, base, depth + 1, files, projectRules);
      } else {
        files.push(relPath);
        if (entry.name.endsWith(".mdc")) {
          projectRules.push({
            path: entry.name,
            location: relative(base, dir) || ".",
          });
        }
      }
    }
  } catch (scanError) {
    logger.error(
      "Failed to scan directory recursively for project context",
      scanError as Error,
      { dir }
    );
  }
}

/**
 * GitAdapter - Implements git operations for project context
 */
export class GitAdapter implements GitPort {
  /**
   * Gets project context including tracked files, project rules, and active tabs
   *
   * @param scanRoot - The root directory to scan
   * @returns Project context object with files, rules, and active tabs
   */
  async getProjectContext(scanRoot: string) {
    const projectRules: { path: string; location: string }[] = [];
    const activeTabs: { path: string }[] = [];
    let files: string[] = [];

    try {
      // Try git ls-files first for tracked files
      const { stdout } = await runGitCommand({
        cwd: scanRoot,
        args: ["ls-files"],
        maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES,
      });
      files = stdout.split("\n").filter((f) => f.trim().length > 0);

      // Find .mdc project rule files
      for (const filePath of files) {
        if (filePath.endsWith(".mdc")) {
          projectRules.push({
            path: filePath,
            location: dirname(filePath) === "." ? "." : dirname(filePath),
          });
        }
      }
    } catch (error) {
      logger.warn("git ls-files failed; falling back to filesystem scan", {
        scanRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to filesystem scan if git is not available
      await scanDirRecursive(scanRoot, scanRoot, 0, files, projectRules);
    }

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
