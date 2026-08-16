import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GitScopedFinalCommitAdapter } from "./git-scoped-final-commit.adapter";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("GitScopedFinalCommitAdapter", () => {
  test("commits only run-owned files and preserves the user's real index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "eragear-final-commit-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Eragear Test"]);
    await git(root, ["config", "user.email", "test@eragear.local"]);
    await writeFile(path.join(root, "owned.txt"), "baseline\n");
    await writeFile(path.join(root, "outside.txt"), "baseline\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "baseline"]);
    const head = (await git(root, ["rev-parse", "HEAD"])).trim();

    await writeFile(path.join(root, "outside.txt"), "user staged\n");
    await git(root, ["add", "outside.txt"]);
    await writeFile(path.join(root, "outside.txt"), "user unstaged\n");
    await writeFile(path.join(root, "owned.txt"), "run result\n");
    const fingerprint = createHash("sha256")
      .update("run result\n")
      .digest("hex");
    const adapter = new GitScopedFinalCommitAdapter();

    await expect(
      adapter.commit({
        runId: "run-1",
        projectRoot: root,
        expectedBranch: "main",
        expectedHead: head,
        allowDefaultBranch: false,
        ownedPaths: ["owned.txt"],
        expectedFingerprints: { "owned.txt": fingerprint },
        message: "supervisos: scoped result",
      })
    ).rejects.toThrow("Default-branch commit was not authorized");

    const committed = await adapter.commit({
      runId: "run-1",
      projectRoot: root,
      expectedBranch: "main",
      expectedHead: head.slice(0, 7),
      allowDefaultBranch: true,
      ownedPaths: ["owned.txt"],
      expectedFingerprints: { "owned.txt": fingerprint },
      message: "supervisos: scoped result",
    });

    expect(
      (await git(root, ["show", "--format=", "--name-only", "HEAD"])).trim()
    ).toBe("owned.txt");
    expect((await git(root, ["diff", "--cached", "--name-only"])).trim()).toBe(
      "outside.txt"
    );
    expect((await git(root, ["diff", "--name-only"])).trim()).toBe(
      "outside.txt"
    );
    expect((await git(root, ["rev-parse", committed.safetyRef])).trim()).toBe(
      head
    );
  });

  test("accepts only Supervisor checkpoint commits between approval and finalization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "eragear-final-chain-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Eragear Test"]);
    await git(root, ["config", "user.email", "test@eragear.local"]);
    await writeFile(path.join(root, "owned.txt"), "baseline\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "baseline"]);
    const approvedHead = (await git(root, ["rev-parse", "HEAD"])).trim();

    await git(root, [
      "commit",
      "--allow-empty",
      "-m",
      "supervisos: checkpoint before worker abc123",
    ]);
    await writeFile(path.join(root, "owned.txt"), "worker result\n");
    await git(root, ["add", "-A"]);
    await git(root, [
      "commit",
      "-m",
      "supervisos: checkpoint after worker abc123",
    ]);
    const checkpointHead = (await git(root, ["rev-parse", "HEAD"])).trim();
    const fingerprint = createHash("sha256")
      .update("worker result\n")
      .digest("hex");

    const committed = await new GitScopedFinalCommitAdapter().commit({
      runId: "run-checkpoints",
      projectRoot: root,
      expectedBranch: "main",
      expectedHead: approvedHead,
      allowDefaultBranch: true,
      ownedPaths: ["owned.txt"],
      expectedFingerprints: { "owned.txt": fingerprint },
      message: "supervisos: final result",
    });

    expect((await git(root, ["rev-parse", "HEAD^"])).trim()).toBe(
      checkpointHead
    );
    expect((await git(root, ["rev-parse", committed.safetyRef])).trim()).toBe(
      checkpointHead
    );
  });

  test("finalizes a project nested below the Git repository root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "eragear-final-nested-"));
    roots.push(root);
    const projectRoot = path.join(root, "lab");
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Eragear Test"]);
    await git(root, ["config", "user.email", "test@eragear.local"]);
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "owned.txt"), "baseline\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "baseline"]);
    const approvedHead = (await git(root, ["rev-parse", "HEAD"])).trim();
    await git(root, [
      "commit",
      "--allow-empty",
      "-m",
      "supervisos: checkpoint before worker nested",
    ]);
    await writeFile(path.join(projectRoot, "owned.txt"), "nested result\n");
    await git(root, ["add", "-A"]);
    await git(root, [
      "commit",
      "-m",
      "supervisos: checkpoint after worker nested",
    ]);
    const fingerprint = createHash("sha256")
      .update("nested result\n")
      .digest("hex");

    const committed = await new GitScopedFinalCommitAdapter().commit({
      runId: "run-nested",
      projectRoot,
      expectedBranch: "main",
      expectedHead: approvedHead,
      allowDefaultBranch: true,
      ownedPaths: ["owned.txt"],
      expectedFingerprints: { "owned.txt": fingerprint },
      message: "supervisos: nested final",
    });

    expect((await git(root, ["rev-parse", "HEAD"])).trim()).toBe(
      committed.commitSha
    );
  });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout;
}
