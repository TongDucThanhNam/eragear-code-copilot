import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitWorkspaceFixture(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, "repo");
  const storage = path.join(root, "storage");
  await mkdir(repo, { recursive: true });
  await mkdir(storage, { recursive: true });
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "tests@example.com"]);
  await git(repo, ["config", "user.name", "Eragear Tests"]);
  await writeFile(path.join(repo, "tracked.txt"), "base\n", "utf8");
  await writeFile(path.join(repo, "rename-me.txt"), "rename\n", "utf8");
  await writeFile(path.join(repo, "delete-me.txt"), "delete\n", "utf8");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "fixture"]);
  const head = await git(repo, ["rev-parse", "HEAD"]);
  return {
    root,
    repo,
    storage,
    head: head.trim(),
    cleanup: () => removeTempDirWithRetry(root),
  };
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EBUSY" || code === "EPERM")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
}
