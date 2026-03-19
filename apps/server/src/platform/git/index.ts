/**
 * Git Adapter
 *
 * Implements git operations for code context and project analysis.
 * Provides methods for getting project context, diffs, and reading files.
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
import { isNodeErrno } from "@/shared/utils/node-error.util";

const execFileAsync = promisify(execFile);
const logger = createLogger("Storage");
const GIT_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const EMPTY_DIFF_FILE_PREFIX = "eragear-git-empty-diff-";
const PROJECT_CONTEXT_EXCLUDED_DIR_NAMES = new Set([".git"]);

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

    let entries: Awaited<ReturnType<typeof readdir>>;
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
export class GitAdapter implements GitPort {
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
