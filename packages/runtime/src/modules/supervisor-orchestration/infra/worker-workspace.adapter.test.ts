import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
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

describe("GitWorkerWorkspaceAdapter", () => {
  test("checkpoints the full repository and runs a write attempt in the project root", async () => {
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
    workspaces.push({ adapter, workspace: first });

    expect(first.kind).toBe("direct_git");
    expect(first.projectRoot).toBe(fixture.repo);
    expect(first.repositoryRoot).toBe(fixture.repo);
    expect(first.baseHead).not.toBe(fixture.head);
    expect(
      (await git(fixture.repo, ["log", "-1", "--format=%s"])).trim()
    ).toContain("supervisos: checkpoint before worker");
    expect(first.targetFingerprints["tracked.txt"]).toMatch(SHA256_PATTERN);
  });

  test("commits dirty user state before dispatch instead of hiding it from the worker", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-dirty-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    await writeFile(path.join(fixture.repo, "tracked.txt"), "user state\n");
    const workspace = await adapter.prepare({
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
    });
    workspaces.push({ adapter, workspace });
    expect((await git(fixture.repo, ["status", "--porcelain"])).trim()).toBe(
      ""
    );
    expect(
      (await git(fixture.repo, ["show", "HEAD:tracked.txt"])).replaceAll(
        "\r\n",
        "\n"
      )
    ).toBe("user state\n");
  });

  test("keeps a nested registered project as cwd so its AGENTS.md is visible", async () => {
    const fixture = await createGitWorkspaceFixture(
      "eragear-worker-nested-dirty-"
    );
    cleanups.push(fixture.cleanup);
    const nestedProject = path.join(fixture.repo, "lab");
    await mkdir(nestedProject, { recursive: true });
    await writeFile(
      path.join(nestedProject, "tracked.txt"),
      "nested\n",
      "utf8"
    );
    await writeFile(
      path.join(nestedProject, "AGENTS.md"),
      "# Nested project rules\n",
      "utf8"
    );
    await git(fixture.repo, ["add", "-A"]);
    await git(fixture.repo, ["commit", "-m", "nested fixture"]);
    const head = (await git(fixture.repo, ["rev-parse", "HEAD"])).trim();
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });

    const workspace = await adapter.prepare({
      runId: "run-1",
      taskId: "task-a",
      attemptKey: "attempt-1",
      projectRoot: nestedProject,
      executionMode: "write",
      filesAllowed: ["tracked.txt"],
      baseSnapshot: {
        head,
        dirtyPaths: ["lab/tracked.txt"],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    });
    workspaces.push({ adapter, workspace });
    expect(workspace.kind).toBe("direct_git");
    expect(workspace.projectRoot).toBe(nestedProject);
    expect(
      await readFile(path.join(workspace.projectRoot, "AGENTS.md"), "utf8")
    ).toContain("Nested project rules");
  });

  test("allows serialized attempts after Supervisor checkpoints but rejects foreign commits", async () => {
    const acceptedFixture = await createGitWorkspaceFixture(
      "eragear-worker-checkpoint-chain-"
    );
    cleanups.push(acceptedFixture.cleanup);
    await git(acceptedFixture.repo, [
      "commit",
      "--allow-empty",
      "-m",
      "supervisos: checkpoint after worker previous",
    ]);
    await git(acceptedFixture.repo, [
      "commit",
      "--allow-empty",
      "-m",
      "supervisos: previous approved run",
    ]);
    const acceptedAdapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(acceptedFixture.storage),
    });
    const accepted = await acceptedAdapter.prepare({
      runId: "run-next",
      taskId: "task-next",
      attemptKey: "attempt-next",
      projectRoot: acceptedFixture.repo,
      executionMode: "write",
      filesAllowed: ["tracked.txt"],
      baseSnapshot: {
        head: acceptedFixture.head,
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    });
    workspaces.push({ adapter: acceptedAdapter, workspace: accepted });
    expect(accepted.kind).toBe("direct_git");

    const rejectedFixture = await createGitWorkspaceFixture(
      "eragear-worker-foreign-chain-"
    );
    cleanups.push(rejectedFixture.cleanup);
    await git(rejectedFixture.repo, [
      "commit",
      "--allow-empty",
      "-m",
      "foreign commit",
    ]);
    const rejectedAdapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(rejectedFixture.storage),
    });
    await expect(
      rejectedAdapter.prepare({
        runId: "run-rejected",
        taskId: "task-rejected",
        attemptKey: "attempt-rejected",
        projectRoot: rejectedFixture.repo,
        executionMode: "write",
        filesAllowed: ["tracked.txt"],
        baseSnapshot: {
          head: rejectedFixture.head,
          dirtyPaths: [],
          targetFingerprints: {},
          capturedAt: "2026-07-11T00:00:00.000Z",
        },
      })
    ).rejects.toMatchObject({ code: "BASELINE_HEAD_DRIFT" });

    const spoofedFixture = await createGitWorkspaceFixture(
      "eragear-worker-spoofed-chain-"
    );
    cleanups.push(spoofedFixture.cleanup);
    await writeFile(path.join(spoofedFixture.repo, "tracked.txt"), "spoofed\n");
    await git(spoofedFixture.repo, ["add", "tracked.txt"]);
    await git(spoofedFixture.repo, [
      "commit",
      "-m",
      "supervisos: spoofed result",
    ]);
    const spoofedAdapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(spoofedFixture.storage),
    });
    await expect(
      spoofedAdapter.prepare({
        runId: "run-spoofed",
        taskId: "task-spoofed",
        attemptKey: "attempt-spoofed",
        projectRoot: spoofedFixture.repo,
        executionMode: "write",
        filesAllowed: ["tracked.txt"],
        baseSnapshot: {
          head: spoofedFixture.head,
          dirtyPaths: [],
          targetFingerprints: {},
          capturedAt: "2026-07-11T00:00:00.000Z",
        },
      })
    ).rejects.toMatchObject({ code: "BASELINE_HEAD_DRIFT" });
  });

  test("reclaims a direct workspace after restart and rejects a second writer", async () => {
    const fixture = await createGitWorkspaceFixture("eragear-worker-busy-");
    cleanups.push(fixture.cleanup);
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    const input = {
      runId: "run-1",
      taskId: "task-a",
      attemptKey: "attempt-1",
      projectRoot: fixture.repo,
      executionMode: "write" as const,
      filesAllowed: ["tracked.txt"],
      baseSnapshot: {
        head: fixture.head,
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    };
    const first = await adapter.prepare(input);
    workspaces.push({ adapter, workspace: first });
    await adapter.dispose(first);
    const recoveredAdapter = new GitWorkerWorkspaceAdapter({
      storageRoot: () => Promise.resolve(fixture.storage),
    });
    await recoveredAdapter.claim(first);
    workspaces.push({ adapter: recoveredAdapter, workspace: first });
    const headBeforeRejectedWriter = (
      await git(fixture.repo, ["rev-parse", "HEAD"])
    ).trim();
    await expect(
      recoveredAdapter.prepare({
        ...input,
        runId: "run-2",
        taskId: "task-b",
        attemptKey: "attempt-2",
        baseSnapshot: { ...input.baseSnapshot, head: first.baseHead },
      })
    ).rejects.toMatchObject({ code: "DIRECT_WORKSPACE_BUSY" });
    expect((await git(fixture.repo, ["rev-parse", "HEAD"])).trim()).toBe(
      headBeforeRejectedWriter
    );
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
