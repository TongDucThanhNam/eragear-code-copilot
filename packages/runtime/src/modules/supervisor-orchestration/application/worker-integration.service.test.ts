import { describe, expect, test } from "bun:test";
import type { SupervisorWorkerResult } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import type {
  CollectedWorkerPatch,
  PreparedWorkerWorkspace,
  WorkerWorkspacePort,
} from "./ports/worker-workspace.port";
import { WorkerIntegrationService } from "./worker-integration.service";

const HASH = "a".repeat(64);

function createFixture() {
  const run = createSupervisorRunFixture();
  const sourceTask = run.tasks[1];
  if (!sourceTask) {
    throw new Error("Task fixture missing");
  }
  const task = {
    ...sourceTask,
    filesAllowed: ["src/feature.ts"],
    verificationCommands: ["bun test"],
  };
  const workspace: PreparedWorkerWorkspace = {
    workspaceId: "workspace-1",
    kind: "isolated_git",
    userProjectRoot: run.projectRoot,
    projectRoot: "/isolated",
    baseHead: "abc123",
    targetFingerprints: { "src/feature.ts": HASH },
  };
  const result: SupervisorWorkerResult = {
    semanticStatus: "succeeded",
    reason: "implemented",
    outcomeSummary: "implemented",
    files: {
      touched: ["src/feature.ts"],
      created: [],
      deleted: [],
      renamed: [],
    },
    verification: [
      {
        command: "bun test",
        exitCode: 0,
        outputSummary: "pass",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: "2026-07-11T00:00:01.000Z",
      },
    ],
    patch: {
      artifactId: "patch-1",
      sha256: HASH,
      byteLength: 10,
      storageRef: "/artifact",
    },
    toolFailureSummary: [],
    unresolvedPermissions: [],
    agentId: "agent-1",
    chatId: "chat-1",
    startedAt: "2026-07-11T00:00:00.000Z",
    finishedAt: "2026-07-11T00:00:01.000Z",
  };
  if (!result.patch) {
    throw new Error("Result fixture patch missing");
  }
  const patch: CollectedWorkerPatch = {
    workspace,
    artifact: result.patch,
    files: result.files,
  };
  return { run, task, workspace, result, patch };
}

function createWorkspaceStub(
  options: { drift?: boolean; conflict?: boolean } = {}
) {
  const calls = { apply: 0, dispose: 0 };
  const port = {
    fingerprint() {
      return Promise.resolve({
        "src/feature.ts": options.drift ? "b".repeat(64) : HASH,
      });
    },
    apply() {
      calls.apply += 1;
      return options.conflict
        ? Promise.reject(new Error("patch conflict"))
        : Promise.resolve();
    },
    dispose() {
      calls.dispose += 1;
      return Promise.resolve();
    },
  } as unknown as WorkerWorkspacePort;
  return { port, calls };
}

describe("WorkerIntegrationService", () => {
  test("applies a safe patch once and always disposes the isolated root", async () => {
    const fixture = createFixture();
    const workspace = createWorkspaceStub();
    const decision = await new WorkerIntegrationService(
      workspace.port
    ).integrate(fixture);
    expect(decision).toEqual({ decision: "allow", reasons: [] });
    expect(workspace.calls).toEqual({ apply: 1, dispose: 1 });
  });

  test("never applies baseline drift and still disposes resources", async () => {
    const fixture = createFixture();
    const workspace = createWorkspaceStub({ drift: true });
    const decision = await new WorkerIntegrationService(
      workspace.port
    ).integrate(fixture);
    expect(decision.reasons).toContain("baseline_drift");
    expect(workspace.calls).toEqual({ apply: 0, dispose: 1 });
  });

  test("converts patch check/apply conflicts to needs-user", async () => {
    const fixture = createFixture();
    const workspace = createWorkspaceStub({ conflict: true });
    const decision = await new WorkerIntegrationService(
      workspace.port
    ).integrate(fixture);
    expect(decision).toEqual({ decision: "needs_user", reasons: ["conflict"] });
    expect(workspace.calls).toEqual({ apply: 1, dispose: 1 });
  });
});
