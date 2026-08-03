import { describe, expect, test } from "bun:test";
import type {
  SupervisorTaskRecord,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import type {
  CollectedWorkerPatch,
  PreparedWorkerWorkspace,
} from "./ports/worker-workspace.port";
import { evaluateWorkerIntegrationGate } from "./worker-integration-gate";

const HASH = "a".repeat(64);

function createTask(): SupervisorTaskRecord {
  const task = createSupervisorRunFixture().tasks[1];
  if (!task) {
    throw new Error("Task fixture missing");
  }
  return {
    ...task,
    filesAllowed: ["src/feature.ts", "src/new.ts", "src/delete.ts"],
    verificationCommands: ["bun test"],
  };
}

function createWorkspace(): PreparedWorkerWorkspace {
  return {
    workspaceId: "workspace-1",
    kind: "isolated_git",
    userProjectRoot: "/repo",
    projectRoot: "/isolated",
    baseHead: "abc123",
    targetFingerprints: {
      "src/feature.ts": HASH,
      "src/new.ts": HASH,
      "src/delete.ts": HASH,
    },
  };
}

function createResult(): SupervisorWorkerResult {
  return {
    semanticStatus: "succeeded",
    reason: "implemented",
    outcomeSummary: "Feature implemented",
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
        outputSummary: "all pass",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: "2026-07-11T00:00:01.000Z",
      },
    ],
    patch: {
      artifactId: "patch-1",
      sha256: HASH,
      byteLength: 10,
      storageRef: "/artifacts/patch-1",
    },
    toolFailureSummary: [],
    unresolvedPermissions: [],
    agentId: "agent-1",
    chatId: "chat-1",
    startedAt: "2026-07-11T00:00:00.000Z",
    finishedAt: "2026-07-11T00:00:01.000Z",
  };
}

function createPatch(
  files: SupervisorWorkerResult["files"] = createResult().files
): CollectedWorkerPatch {
  const artifact = createResult().patch;
  if (!artifact) {
    throw new Error("Result fixture patch missing");
  }
  return {
    workspace: createWorkspace(),
    artifact,
    files,
  };
}

describe("evaluateWorkerIntegrationGate", () => {
  test("allows a scoped verified patch with an unchanged baseline", () => {
    const decision = evaluateWorkerIntegrationGate({
      run: createSupervisorRunFixture(),
      task: createTask(),
      workspace: createWorkspace(),
      patch: createPatch(),
      result: createResult(),
      currentFingerprints: { "src/feature.ts": HASH },
    });
    expect(decision).toEqual({ decision: "allow", reasons: [] });
  });

  test("rejects out-of-scope files, dirty overlap, and post-dispatch drift", () => {
    const run = createSupervisorRunFixture({
      baseSnapshot: {
        ...createSupervisorRunFixture().baseSnapshot,
        dirtyPaths: ["src/feature.ts"],
      },
    });
    const patch = createPatch({
      touched: ["src/feature.ts", "outside.ts"],
      created: ["outside.ts"],
      deleted: [],
      renamed: [],
    });
    const decision = evaluateWorkerIntegrationGate({
      run,
      task: createTask(),
      workspace: createWorkspace(),
      patch,
      result: { ...createResult(), files: patch.files },
      currentFingerprints: {
        "src/feature.ts": "b".repeat(64),
        "outside.ts": HASH,
      },
    });
    expect(decision.decision).toBe("needs_user");
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "scope_drift",
        "dirty_path_overlap",
        "baseline_drift",
      ])
    );
  });

  test("rejects every deletion and destructive action", () => {
    const patch = createPatch({
      touched: ["src/delete.ts"],
      created: [],
      deleted: ["src/delete.ts"],
      renamed: [],
    });
    const decision = evaluateWorkerIntegrationGate({
      run: createSupervisorRunFixture(),
      task: createTask(),
      workspace: createWorkspace(),
      patch,
      result: { ...createResult(), files: patch.files },
      currentFingerprints: { "src/delete.ts": HASH },
      destructiveActions: ["delete file"],
    });
    expect(decision.reasons).toEqual(
      expect.arrayContaining(["file_deleted", "destructive_action"])
    );
  });

  test("rejects missing/failed verification, tool failures, and permissions", () => {
    const result = {
      ...createResult(),
      verification: [],
      toolFailureSummary: ["tool failed"],
      unresolvedPermissions: ["write approval"],
    };
    const decision = evaluateWorkerIntegrationGate({
      run: createSupervisorRunFixture(),
      task: createTask(),
      workspace: createWorkspace(),
      patch: createPatch(),
      result,
      currentFingerprints: { "src/feature.ts": HASH },
    });
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "verification_failed",
        "tool_failure",
        "unresolved_permission",
      ])
    );
  });

  test("rejects write completion without a patch artifact", () => {
    const result = { ...createResult(), patch: undefined };
    expect(
      evaluateWorkerIntegrationGate({
        run: createSupervisorRunFixture(),
        task: createTask(),
        workspace: createWorkspace(),
        result,
        currentFingerprints: { "src/feature.ts": HASH },
      }).reasons
    ).toContain("patch_missing");
  });
});
