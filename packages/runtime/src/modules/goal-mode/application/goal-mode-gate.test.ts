import { describe, expect, test } from "bun:test";
import { evaluateGoalModeGate } from "./goal-mode-gate";

describe("evaluateGoalModeGate", () => {
  test("auto-continues when touched and created files stay in scope and verification passes", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts", "src/b.ts"],
        filesTouched: ["src/a.ts"],
        filesCreated: ["src/b.ts"],
        filesDeleted: [],
        verification: { command: "bun test", exitCode: 0 },
      })
    ).toEqual({ decision: "auto_continue", reasons: [] });
  });

  test("blocks out-of-scope modifications", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts"],
        filesTouched: ["src/other.ts"],
        filesCreated: [],
        filesDeleted: [],
      })
    ).toEqual({
      decision: "needs_user",
      reasons: ["scope_drift_modified"],
    });
  });

  test("blocks out-of-scope creations", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts"],
        filesTouched: [],
        filesCreated: ["src/new.ts"],
        filesDeleted: [],
      })
    ).toEqual({
      decision: "needs_user",
      reasons: ["scope_drift_created"],
    });
  });

  test("blocks all deletions even when deleted files are allowed", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts"],
        filesTouched: [],
        filesCreated: [],
        filesDeleted: ["src/a.ts"],
      })
    ).toEqual({
      decision: "needs_user",
      reasons: ["file_deleted"],
    });
  });

  test("blocks destructive actions", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts"],
        filesTouched: [],
        filesCreated: [],
        filesDeleted: [],
        destructiveAction: true,
      })
    ).toEqual({
      decision: "needs_user",
      reasons: ["destructive_action"],
    });
  });

  test("blocks verification failures", () => {
    expect(
      evaluateGoalModeGate({
        filesAllowed: ["src/a.ts"],
        filesTouched: ["src/a.ts"],
        filesCreated: [],
        filesDeleted: [],
        verification: { command: "bun test", exitCode: 1 },
      })
    ).toEqual({
      decision: "needs_user",
      reasons: ["verification_failed"],
    });
  });
});
