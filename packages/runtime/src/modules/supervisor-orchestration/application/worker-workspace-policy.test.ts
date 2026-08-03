import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitWorkerWorkspaceAdapter } from "../infra/git-worker-workspace.adapter";

const cleanups: string[] = [];

afterEach(async () => {
  for (const root of cleanups.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("non-Git worker workspace policy", () => {
  test("allows concurrent reads and visibly rejects writes", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "eragear-workspace-policy-")
    );
    cleanups.push(root);
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    const adapter = new GitWorkerWorkspaceAdapter({
      storageRoot: async () => path.join(root, "storage"),
    });
    const input = {
      runId: "run-1",
      taskId: "read-1",
      attemptKey: "attempt-1",
      projectRoot,
      executionMode: "read_only" as const,
      filesAllowed: [],
      baseSnapshot: {
        dirtyPaths: [],
        targetFingerprints: {},
        capturedAt: "2026-07-11T00:00:00.000Z",
      },
    };
    const reads = await Promise.all([
      adapter.prepare(input),
      adapter.prepare({ ...input, taskId: "read-2" }),
    ]);
    expect(reads.map((workspace) => workspace.projectRoot)).toEqual([
      projectRoot,
      projectRoot,
    ]);
    await expect(
      adapter.prepare({ ...input, taskId: "write", executionMode: "write" })
    ).rejects.toMatchObject({ code: "NON_GIT_WRITE_UNSUPPORTED" });
  });
});
