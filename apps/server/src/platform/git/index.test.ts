import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitAdapter } from "./index";

const tempDirs: string[] = [];

async function createTempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eragear-git-adapter-"));
  tempDirs.push(dir);
  return dir;
}

function runGitOrThrow(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status === 0) {
    return;
  }
  throw new Error(
    `git ${args.join(" ")} failed with status ${String(result.status)}: ${result.stderr}`
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("GitAdapter", () => {
  test("getDiff handles untracked file names without shell interpolation", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    const untrackedName = "$(echo injected).txt";
    await writeFile(join(projectRoot, untrackedName), "hello\n", "utf8");

    const adapter = new GitAdapter();
    const patch = await adapter.getDiff(projectRoot);

    expect(patch).toContain(`b/${untrackedName}`);
    expect(patch).toContain("+hello");
  });

  test("readFileWithinRoot rejects absolute and traversal paths", async () => {
    const projectRoot = await createTempProjectDir();
    const adapter = new GitAdapter();
    await writeFile(join(projectRoot, "ok.txt"), "safe", "utf8");

    await expect(
      adapter.readFileWithinRoot(projectRoot, "../outside.txt")
    ).rejects.toThrow("Access denied");
    await expect(
      adapter.readFileWithinRoot(projectRoot, join(projectRoot, "ok.txt"))
    ).rejects.toThrow("Access denied");
  });

  test("readFileWithinRoot reads files inside project root", async () => {
    const projectRoot = await createTempProjectDir();
    const adapter = new GitAdapter();
    await writeFile(join(projectRoot, "inside.txt"), "hello", "utf8");

    await expect(
      adapter.readFileWithinRoot(projectRoot, "inside.txt")
    ).resolves.toBe("hello");
  });
});
