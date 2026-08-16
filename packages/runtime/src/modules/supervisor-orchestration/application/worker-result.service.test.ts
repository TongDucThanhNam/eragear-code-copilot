import { describe, expect, test } from "bun:test";
import type {
  SupervisorTaskRecord,
  SupervisorWorkerAttempt,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { WorkerResultService } from "./worker-result.service";

const HASH = "a".repeat(64);

function createTask(
  overrides: Partial<SupervisorTaskRecord> = {}
): SupervisorTaskRecord {
  const task = createSupervisorRunFixture().tasks[1];
  if (!task) {
    throw new Error("Task fixture missing");
  }
  return {
    ...task,
    verificationCommands: ["bun test"],
    ...overrides,
  };
}

function createAttempt(): SupervisorWorkerAttempt {
  return {
    attemptId: "attempt-1",
    chatId: "chat-1",
    agentId: "agent-1",
    status: "running",
    idempotencyKey: "run:task:1",
    startedAt: "2026-07-11T00:00:00.000Z",
  };
}

function createResult(
  overrides: Partial<SupervisorWorkerResult> = {}
): SupervisorWorkerResult {
  return {
    semanticStatus: "succeeded",
    reason: "complete",
    outcomeSummary: "Implemented with evidence",
    files: {
      touched: ["packages/runtime/src/feature.ts"],
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
    ...overrides,
  };
}

describe("WorkerResultService", () => {
  test("accepts structured successful evidence", () => {
    expect(
      new WorkerResultService().assess({
        task: createTask(),
        attempt: createAttempt(),
        result: createResult(),
      }).decision
    ).toBe("accept");
  });

  test("rejects prose-only or malformed output", () => {
    expect(() =>
      new WorkerResultService().assess({
        task: createTask(),
        attempt: createAttempt(),
        result: "Done!",
      })
    ).toThrow();
  });

  test("rejects missing required verification and patch evidence", () => {
    const assessment = new WorkerResultService().assess({
      task: createTask(),
      attempt: createAttempt(),
      result: createResult({ verification: [], patch: undefined }),
    });
    expect(assessment.reasons).toEqual(
      expect.arrayContaining(["verification_failed", "missing_patch"])
    );
  });

  test("does not turn optional diagnostic failures into Supervisor blockers", () => {
    const assessment = new WorkerResultService().assess({
      task: createTask({ verificationCommands: [] }),
      attempt: createAttempt(),
      result: createResult({
        verification: [
          {
            command: "project-wide diagnostic",
            exitCode: 1,
            outputSummary: "unrelated pre-existing failures",
            startedAt: "2026-07-11T00:00:00.000Z",
            finishedAt: "2026-07-11T00:00:01.000Z",
          },
        ],
      }),
    });
    expect(assessment).toEqual(
      expect.objectContaining({ decision: "accept", reasons: [] })
    );
  });

  test("rejects unresolved permissions, tool failures, and identity mismatch", () => {
    const assessment = new WorkerResultService().assess({
      task: createTask(),
      attempt: createAttempt(),
      result: createResult({
        agentId: "other-agent",
        chatId: "other-chat",
        toolFailureSummary: ["tool failed"],
        unresolvedPermissions: ["write denied"],
      }),
    });
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        "agent_mismatch",
        "chat_mismatch",
        "tool_failure",
        "unresolved_permission",
      ])
    );
  });

  test("rejects any changed-file claim from a read-only worker", () => {
    const result = createResult({ patch: undefined });
    const assessment = new WorkerResultService().assess({
      task: createTask({
        executionMode: "read_only",
        filesAllowed: ["packages/runtime/src/feature.ts"],
      }),
      attempt: createAttempt(),
      result,
    });
    expect(assessment.reasons).toContain("read_only_changed_files");
  });
});
