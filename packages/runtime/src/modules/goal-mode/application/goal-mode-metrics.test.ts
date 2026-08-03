import { describe, expect, test } from "bun:test";
import type { SupervisorGoalState } from "./goal-mode.schemas";
import { computeGoalMetrics } from "./goal-mode-metrics";

function createGoalState(): SupervisorGoalState {
  return {
    goalId: "goal-1",
    userId: "user-1",
    originalIntent: "Implement goal mode",
    constraints: [],
    currentPhaseId: "phase-2",
    phases: [
      {
        phaseId: "phase-1",
        goal: "V0",
        filesAllowed: ["packages/runtime/src/modules/goal-mode/index.ts"],
        scopeResolution: {
          resolverVersion: "v0-no-graph",
          primaryTarget: {
            path: "packages/runtime/src/modules/goal-mode/index.ts",
            score: 10,
            reason: "matched",
          },
          secondaryTargets: [],
          resolvedViaLLM: false,
          diagnostics: {
            signalScanSkippedBySize: 1,
            symbolExtractionMode: "regex",
            indexedFiles: 2,
            candidateCount: 1,
          },
        },
        attempts: [
          {
            attemptId: "attempt-1",
            chatId: "chat-1",
            startedAt: "2026-06-20T00:00:00.000Z",
            filesTouched: ["packages/runtime/src/modules/goal-mode/index.ts"],
            filesCreated: [],
            filesDeleted: [],
            gate: { decision: "auto_continue", reasons: [] },
          },
        ],
        decision: "auto_continue",
      },
      {
        phaseId: "phase-2",
        goal: "V1",
        filesAllowed: [
          "packages/runtime/src/modules/scope-resolution/index.ts",
        ],
        scopeResolution: {
          resolverVersion: "v1-import-graph",
          primaryTarget: {
            path: "packages/runtime/src/modules/scope-resolution/index.ts",
            score: 20,
            reason: "matched",
          },
          secondaryTargets: [],
          resolvedViaLLM: true,
          diagnostics: {
            signalScanSkippedBySize: 2,
            symbolExtractionMode: "ast",
            indexedFiles: 4,
            candidateCount: 2,
            graphConfidence: 0.5,
          },
        },
        attempts: [
          {
            attemptId: "attempt-2",
            chatId: "chat-2",
            startedAt: "2026-06-20T00:10:00.000Z",
            filesTouched: ["outside.ts"],
            filesCreated: [],
            filesDeleted: [],
            gate: {
              decision: "needs_user",
              reasons: ["scope_drift_modified", "verification_failed"],
            },
          },
          {
            attemptId: "attempt-3",
            chatId: "chat-3",
            startedAt: "2026-06-20T00:20:00.000Z",
            filesTouched: [
              "packages/runtime/src/modules/scope-resolution/index.ts",
            ],
            filesCreated: [],
            filesDeleted: [],
          },
        ],
        decision: "needs_user",
      },
    ],
  };
}

describe("computeGoalMetrics", () => {
  test("derives metrics from phases and attempts", () => {
    const metrics = computeGoalMetrics(createGoalState());

    expect(metrics.phaseCount).toBe(2);
    expect(metrics.attemptCount).toBe(3);
    expect(metrics.avgAttemptsPerPhase).toBe(1.5);
    expect(metrics.resolvedViaLLMRate).toEqual({
      "v0-no-graph": 0,
      "v1-import-graph": 1,
    });
    expect(metrics.gateRejectReasons).toEqual({
      scope_drift_modified: 1,
      verification_failed: 1,
    });
    expect(metrics.signalScanSkippedBySize).toBe(3);
  });
});
