/**
 * Git Adapter
 *
 * Implements git operations for code context and project analysis.
 * Provides methods for getting project context, diffs, and reading files.
 * Falls back to filesystem scanning when git is unavailable.
 *
 * @module infra/git
 */

import { exec } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { GitPort } from "@/modules/tooling";

const execAsync = promisify(exec);
/** Regex to prevent path traversal attacks */
const PATHTraversal_REGEX = /^(\.\.(\/|\\|$))+/;

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
    console.error(`Failed to scan ${dir}:`, scanError);
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
      const { stdout } = await execAsync("git ls-files", {
        cwd: scanRoot,
        maxBuffer: 10 * 1024 * 1024,
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
      console.warn(
        "[GitAdapter] git ls-files failed, falling back to fs scan",
        error
      );
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
        const { stdout } = await execAsync("git diff HEAD", {
          cwd: projectRoot,
        });
        combinedPatch += stdout;
      } catch {
        // Ignore missing HEAD
      }

      // Get diff for untracked files
      const { stdout: untrackedFilesOutput } = await execAsync(
        "git ls-files --others --exclude-standard",
        { cwd: projectRoot }
      );
      const untrackedFiles = untrackedFilesOutput
        .split("\n")
        .filter((filePath) => filePath.trim().length > 0);

      for (const filePath of untrackedFiles) {
        try {
          await execAsync(
            `git --no-pager diff --no-index /dev/null "${filePath}"`,
            { cwd: projectRoot }
          );
        } catch (error) {
          const execError = error as { stdout?: string };
          if (execError.stdout) {
            combinedPatch += `\n${execError.stdout}`;
          }
        }
      }

      return combinedPatch;
    } catch (error) {
      console.error("Failed to get git diff", error);
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
    const safePath = normalize(relativePath).replace(PATHTraversal_REGEX, "");
    const fullPath = join(projectRoot, safePath);

    if (!fullPath.startsWith(projectRoot)) {
      throw new Error("Access denied: Path outside project root");
    }

    try {
      return await readFile(fullPath, "utf8");
    } catch (error) {
      console.error(`Failed to read file ${fullPath}`, error);
      throw new Error(`Failed to read file: ${error}`);
    }
  }
}
