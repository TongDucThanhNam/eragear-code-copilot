import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PreparedWorkerWorkspace } from "../application/ports/worker-workspace.port";
import {
  GitWorkerWorkspaceAdapter,
  WorkerWorkspacePolicyError,
} from "./git-worker-workspace.adapter";
import { createGitWorkspaceFixture } from "./git-worker-workspace.test-helper";

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

describe("GitWorkerWorkspaceAdapter", () => {
  test("creates a distinct detached worktree for every write attempt", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-space-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    const baseSnapshot = {
      head: fixture.head,
      dirtyPaths: [],
      targetFingerprints: {},
      capturedAt: "2026-07-11T00:00:00.000Z",
    };
    const first = await adapter.prepare({
      runId: "run-1",
      taskId: "task-a",
      attemptKey: "attempt-1",
      projectRoot: fixture.repo,
      executionMode: "write",
      filesAllowed: ["tracked.txt"],
      baseSnapshot,
    });
    const second = await adapter.prepare({
      runId: "run-1",
      taskId: "task-b",
      attemptKey: "attempt-1",
      projectRoot: fixture.repo,
      executionMode: "write",
      filesAllowed: ["rename-me.txt"],
      baseSnapshot,
    });
    workspaces.push(
      { adapter, workspace: first },
      { adapter, workspace: second }
    );

    expect(first.kind).toBe("isolated_git");
    expect(first.projectRoot).not.toBe(fixture.repo);
    expect(second.projectRoot).not.toBe(first.projectRoot);
    await expect(
      access(path.join(first.projectRoot, ".git"))
    ).resolves.toBeNull();
    expect(first.targetFingerprints["tracked.txt"]).toMatch(SHA256_PATTERN);
  });

  test("fails closed before dispatch when scoped files overlap dirty user paths", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-dirty-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    await expect(
      adapter.prepare({
        runId: "run-1",
        taskId: "task-a",
        attemptKey: "attempt-1",
        projectRoot: fixture.repo,
        executionMode: "write",
        filesAllowed: ["tracked.txt"],
        baseSnapshot: {
          head: fixture.head,
          dirtyPaths: ["tracked.txt"],
          targetFingerprints: {},
          capturedAt: "2026-07-11T00:00:00.000Z",
        },
      })
    ).rejects.toBeInstanceOf(WorkerWorkspacePolicyError);
  });

  test("allows concurrent read-only non-Git work but rejects automatic writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "eragear-non-git-"));
    const storage = path.join(root, "storage");
    const project = path.join(root, "project");
    await mkdir(storage, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "note.txt"), "note", "utf8");
    cleanups.push(async () => {
      const { rm } = await import("node:fs/promises");
      await rm(root, { recursive: true, force: true });
    });
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(storage),
    });
    const input = {
      runId: "run-1",
      taskId: "read",
      attemptKey: "attempt-1",
      projectRoot: project,
      executionMode: "read_only" as const,
      filesAllowed: ["note.txt"],
      baseSnapshot: {
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    };
    const [first, second] = await Promise.all([
      adapter.prepare(input),
      adapter.prepare({ ...input, taskId: "read-2" }),
    ]);
    expect(first.projectRoot).toBe(project);
    expect(second.projectRoot).toBe(project);
    await expect(
      adapter.prepare({ ...input, taskId: "write", executionMode: "write" })
    ).rejects.toMatchObject({ code: "NON_GIT_WRITE_UNSUPPORTED" });
  });
});
