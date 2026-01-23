// Git adapter for code processing
import { exec } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { GitPort } from "../../shared/types/ports";

const execAsync = promisify(exec);
const PATHTraversal_REGEX = /^(\.\.(\/|\\|$))+/;

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

export class GitAdapter implements GitPort {
  async getProjectContext(scanRoot: string) {
    const projectRules: { path: string; location: string }[] = [];
    const activeTabs: { path: string }[] = [];
    let files: string[] = [];

    try {
      const { stdout } = await execAsync("git ls-files", {
        cwd: scanRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      files = stdout.split("\n").filter((f) => f.trim().length > 0);

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
      await scanDirRecursive(scanRoot, scanRoot, 0, files, projectRules);
    }

    return {
      projectRules,
      activeTabs,
      files,
    };
  }

  async getDiff(projectRoot: string): Promise<string> {
    try {
      let combinedPatch = "";

      try {
        const { stdout } = await execAsync("git diff HEAD", {
          cwd: projectRoot,
        });
        combinedPatch += stdout;
      } catch {
        // Ignore missing HEAD
      }

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
