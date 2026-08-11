import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitWorkflowProgress } from "#runtime/modules/git";
import { GitAdapter } from ".";
import { GitWorkflowAdapter } from "./workflow";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("GitWorkflowAdapter", () => {
  test("commits, pushes, and runs a stacked commit+push action", async () => {
    const fixture = await createFixture();
    const adapter = new GitWorkflowAdapter(new GitAdapter());
    await writeFile(path.join(fixture.projectRoot, "file.txt"), "commit one\n");

    const initialStatus = await adapter.getStatus(fixture.projectRoot);
    expect(initialStatus).toMatchObject({
      isRepository: true,
      refName: "main",
      defaultRef: "main",
      isDefaultRef: true,
      hasWorkingTreeChanges: true,
      hasPrimaryRemote: true,
      hasUpstream: true,
    });

    const committed = await adapter.commit({
      projectRoot: fixture.projectRoot,
      message: "First workflow commit",
    });
    expect(committed.commitSha).toMatch(COMMIT_SHA_REGEX);

    const pushed = await adapter.push({ projectRoot: fixture.projectRoot });
    expect(pushed).toEqual({ branch: "main", upstream: "origin/main" });
    expect(await revParse(fixture.remoteRoot, "refs/heads/main")).toBe(
      committed.commitSha
    );

    await writeFile(path.join(fixture.projectRoot, "file.txt"), "commit two\n");
    const combined = await adapter.commitAndPush({
      projectRoot: fixture.projectRoot,
      message: "Second workflow commit",
    });
    expect(combined.commitSha).toMatch(COMMIT_SHA_REGEX);
    expect(await revParse(fixture.remoteRoot, "refs/heads/main")).toBe(
      combined.commitSha
    );

    await writeFile(
      path.join(fixture.projectRoot, "file.txt"),
      "commit three\n"
    );
    const progress: GitWorkflowProgress[] = [];
    const stacked = await adapter.runStackedAction(
      {
        projectRoot: fixture.projectRoot,
        actionId: "action-1",
        action: "commit_push",
        message: "Stacked workflow commit",
      },
      (event) => progress.push(event)
    );
    expect(stacked).toMatchObject({ pushed: true });
    expect(stacked.commitSha).toMatch(COMMIT_SHA_REGEX);
    expect(progress.map((event) => `${event.stage}:${event.status}`)).toEqual([
      "status:running",
      "status:completed",
      "commit:running",
      "commit:completed",
      "push:running",
      "push:completed",
    ]);
  });

  test("sets origin upstream when pushing a new branch", async () => {
    const fixture = await createFixture();
    const adapter = new GitWorkflowAdapter(new GitAdapter());
    await git(fixture.projectRoot, ["switch", "-c", "feature/workflow"]);
    await writeFile(path.join(fixture.projectRoot, "feature.txt"), "feature\n");
    await adapter.commit({
      projectRoot: fixture.projectRoot,
      message: "Feature commit",
    });

    await expect(
      adapter.push({ projectRoot: fixture.projectRoot })
    ).resolves.toEqual({
      branch: "feature/workflow",
      upstream: "origin/feature/workflow",
    });
    expect(
      await revParse(fixture.remoteRoot, "refs/heads/feature/workflow")
    ).toBe(await revParse(fixture.projectRoot, "HEAD"));
  });

  test("creates GitHub pull requests through non-interactive gh arguments", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const adapter = new GitWorkflowAdapter(
      {} as never,
      (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return Promise.resolve({
          stdout: "https://github.example.test/org/repo/pull/42\n",
          stderr: "",
        });
      }
    );

    await expect(
      adapter.createPullRequest({
        projectRoot: "C:/repo",
        title: "Add Git workflow",
        body: "Verified locally",
        base: "main",
        draft: true,
      })
    ).resolves.toEqual({
      url: "https://github.example.test/org/repo/pull/42",
      title: "Add Git workflow",
      state: "open",
    });
    expect(calls).toEqual([
      {
        command: "gh",
        cwd: "C:/repo",
        args: [
          "pr",
          "create",
          "--title",
          "Add Git workflow",
          "--body",
          "Verified locally",
          "--base",
          "main",
          "--draft",
        ],
      },
    ]);
  });

  test("creates persistent worktrees, reports branch diffs, and removes them safely", async () => {
    const fixture = await createFixture();
    const storageRoot = path.join(path.dirname(fixture.projectRoot), "storage");
    const adapter = new GitWorkflowAdapter(
      new GitAdapter(),
      executeCommand,
      () => Promise.resolve(storageRoot)
    );

    const created = await adapter.createWorktree({
      projectRoot: fixture.projectRoot,
      worktreeId: "chat-1",
    });
    expect(created.branchName).toBe("eragear/worktree/chat-1");
    expect(
      path.resolve(created.path).startsWith(path.resolve(storageRoot))
    ).toBe(true);
    await expect(
      adapter.createWorktree({
        projectRoot: fixture.projectRoot,
        worktreeId: "chat-1",
      })
    ).resolves.toEqual(created);

    await writeFile(path.join(created.path, "worktree.txt"), "worktree\n");
    await adapter.commit({
      projectRoot: created.path,
      message: "Worktree change",
    });
    const branchPatch = await adapter.getBranchDiff({
      projectRoot: created.path,
    });
    expect(branchPatch).toContain("worktree.txt");
    expect(
      (await adapter.listWorktrees({ projectRoot: fixture.projectRoot })).some(
        (worktree) => worktree.path === created.path
      )
    ).toBe(true);

    await adapter.removeWorktree({
      projectRoot: fixture.projectRoot,
      worktreePath: created.path,
    });
    expect(
      (await adapter.listWorktrees({ projectRoot: fixture.projectRoot })).some(
        (worktree) => worktree.path === created.path
      )
    ).toBe(false);
  });
});

async function executeCommand(command: string, args: string[], cwd: string) {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function createFixture(): Promise<{
  projectRoot: string;
  remoteRoot: string;
}> {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "eragear-git-workflow-")
  );
  roots.push(fixtureRoot);
  const projectRoot = path.join(fixtureRoot, "project");
  const remoteRoot = path.join(fixtureRoot, "remote.git");
  await git(fixtureRoot, ["init", "--bare", remoteRoot]);
  await git(fixtureRoot, ["init", "-b", "main", projectRoot]);
  await git(projectRoot, ["config", "user.name", "Eragear Test"]);
  await git(projectRoot, ["config", "user.email", "eragear@example.test"]);
  await writeFile(path.join(projectRoot, "file.txt"), "initial\n");
  await git(projectRoot, ["add", "--all"]);
  await git(projectRoot, ["commit", "-m", "Initial commit"]);
  await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
  await git(projectRoot, ["push", "--set-upstream", "origin", "main"]);
  await git(remoteRoot, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { projectRoot, remoteRoot };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function revParse(cwd: string, ref: string): Promise<string> {
  return await git(cwd, ["rev-parse", ref]);
}
