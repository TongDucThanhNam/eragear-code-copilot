import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PreparedWorkerWorkspace } from "../application/ports/worker-workspace.port";
import { GitWorkerWorkspaceAdapter } from "./git-worker-workspace.adapter";
import {
  createGitWorkspaceFixture,
  git,
} from "./git-worker-workspace.test-helper";

const workspaces: Array<{
  adapter: GitWorkerWorkspaceAdapter;
  workspace: PreparedWorkerWorkspace;
}> = [];
const cleanups: Array<() => Promise<void>> = [];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

afterEach(async () => {
  for (const item of workspaces.splice(0).reverse()) {
    await item.adapter.dispose(item.workspace).catch(() => undefined);
  }
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe("GitWorkerWorkspaceAdapter patch artifacts", () => {
  test("collects created, modified, deleted, renamed, untracked, and binary changes", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-patch-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    const workspace = await adapter.prepare({
      runId: "run-1",
      taskId: "task-a",
      attemptKey: "attempt-1",
      projectRoot: fixture.repo,
      executionMode: "write",
      filesAllowed: [
        "tracked.txt",
        "rename-me.txt",
        "renamed.txt",
        "delete-me.txt",
        "created.txt",
        "binary.bin",
      ],
      baseSnapshot: {
        head: fixture.head,
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    });
    workspaces.push({ adapter, workspace });
    await writeFile(
      path.join(workspace.projectRoot, "tracked.txt"),
      "changed\n"
    );
    await writeFile(
      path.join(workspace.projectRoot, "created.txt"),
      "created\n"
    );
    await writeFile(
      path.join(workspace.projectRoot, "binary.bin"),
      Buffer.from([0, 1, 2, 3, 255, 0, 5])
    );
    await rename(
      path.join(workspace.projectRoot, "rename-me.txt"),
      path.join(workspace.projectRoot, "renamed.txt")
    );
    await unlink(path.join(workspace.projectRoot, "delete-me.txt"));

    const collected = await adapter.collect(workspace);
    expect(collected.files.touched).toEqual([
      "binary.bin",
      "created.txt",
      "delete-me.txt",
      "rename-me.txt",
      "renamed.txt",
      "tracked.txt",
    ]);
    expect(collected.files.created).toEqual(["binary.bin", "created.txt"]);
    expect(collected.files.deleted).toEqual(["delete-me.txt"]);
    expect(collected.files.renamed).toEqual([
      { from: "rename-me.txt", to: "renamed.txt" },
    ]);
    expect(collected.artifact.sha256).toMatch(SHA256_PATTERN);
    expect(collected.artifact.byteLength).toBeGreaterThan(0);
    expect(await readFile(collected.artifact.storageRef, "utf8")).toContain(
      "GIT binary patch"
    );
  });

  test("applies an integrity-checked patch without changing user HEAD", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-apply-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    const workspace = await adapter.prepare({
      runId: "run-1",
      taskId: "task-a",
      attemptKey: "attempt-1",
      projectRoot: fixture.repo,
      executionMode: "write",
      filesAllowed: ["tracked.txt", "created.txt"],
      baseSnapshot: {
        head: fixture.head,
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    });
    workspaces.push({ adapter, workspace });
    await writeFile(
      path.join(workspace.projectRoot, "tracked.txt"),
      "worker\n"
    );
    await writeFile(path.join(workspace.projectRoot, "created.txt"), "new\n");
    const collected = await adapter.collect(workspace);
    const headBefore = (await git(fixture.repo, ["rev-parse", "HEAD"])).trim();
    await adapter.apply({ workspace, artifact: collected.artifact });
    const headAfter = (await git(fixture.repo, ["rev-parse", "HEAD"])).trim();
    expect(headAfter).toBe(headBefore);
    expect(
      (
        await readFile(path.join(fixture.repo, "tracked.txt"), "utf8")
      ).replaceAll("\r\n", "\n")
    ).toBe("worker\n");
    expect(
      (
        await readFile(path.join(fixture.repo, "created.txt"), "utf8")
      ).replaceAll("\r\n", "\n")
    ).toBe("new\n");

    await rm(collected.artifact.storageRef, { force: true });
    await expect(
      adapter.apply({ workspace, artifact: collected.artifact })
    ).rejects.toThrow();
  });
});
