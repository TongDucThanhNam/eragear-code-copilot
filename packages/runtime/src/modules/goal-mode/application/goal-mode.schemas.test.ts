import { describe, expect, test } from "bun:test";
import {
  GateResultSchema,
  GoalModeOutcomeSummarySchema,
  SupervisorGoalStateSchema,
} from "./goal-mode.schemas";

describe("Goal Mode schemas", () => {
  test("validates structured outcome summaries", () => {
    const summary = GoalModeOutcomeSummarySchema.parse({
      keyDecision: "Gate passed after focused verification",
      filesChanged: ["src/a.ts"],
      gotcha: "Do not advance on deletion",
      verification: "bun test goal-mode -> exit 0",
    });

    expect(summary.keyDecision).toContain("Gate passed");
    expect(() =>
      GoalModeOutcomeSummarySchema.parse({
        filesChanged: ["src/a.ts"],
        gotcha: "missing decision",
        verification: "not run",
      })
    ).toThrow();
  });

  test("requires needs_user gates to include reasons", () => {
    expect(
      GateResultSchema.parse({
        decision: "auto_continue",
        reasons: [],
      })
    ).toEqual({ decision: "auto_continue", reasons: [] });
    expect(() =>
      GateResultSchema.parse({
        decision: "needs_user",
        reasons: [],
      })
    ).toThrow();
  });

  test("keeps goal state separate from derived metrics", () => {
    const parsed = SupervisorGoalStateSchema.parse({
      goalId: "goal-1",
      userId: "user-1",
      originalIntent: "Ship Goal Mode",
      constraints: ["No raw diffs"],
      currentPhaseId: "phase-1",
      phases: [],
    });

    expect(parsed).not.toHaveProperty("metrics");
  });
});
