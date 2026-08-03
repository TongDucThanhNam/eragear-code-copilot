import { describe, expect, test } from "bun:test";
import type { PhaseRecord, SupervisorGoalState } from "./goal-mode.schemas";
import { buildGoalModeNextPrompt } from "./goal-mode-prompt.builder";

const scopeResolution: PhaseRecord["scopeResolution"] = {
  resolverVersion: "v0-no-graph",
  primaryTarget: {
    path: "src/a.ts",
    score: 10,
    reason: "symbol match",
  },
  secondaryTargets: [],
  resolvedViaLLM: false,
  diagnostics: {
    signalScanSkippedBySize: 0,
    symbolExtractionMode: "regex",
    indexedFiles: 1,
    candidateCount: 1,
  },
};

function createGoal(): SupervisorGoalState {
  return {
    goalId: "goal-1",
    userId: "user-1",
    originalIntent: "Ship Goal Mode",
    constraints: ["Preserve ACP permission boundaries"],
    currentPhaseId: "phase-2",
    phases: [],
  };
}

function createPhase(): PhaseRecord {
  return {
    phaseId: "phase-2",
    goal: "Implement guarded gates",
    filesAllowed: ["src/a.ts", "src/b.ts"],
    scopeResolution,
    attempts: [],
    decision: "pending",
    verificationCommand: "bun test goal-mode",
  };
}

describe("buildGoalModeNextPrompt", () => {
  test("uses compact summaries and allowlist without raw transcripts or raw diffs", () => {
    const rawTranscript = "RAW_TRANSCRIPT_SHOULD_NOT_LEAK";
    const rawDiff = "diff --git a/src/a.ts b/src/a.ts";

    const prompt = buildGoalModeNextPrompt({
      goal: createGoal(),
      currentPhase: createPhase(),
      completedSummaries: [
        {
          keyDecision: "Added controller state writes",
          filesChanged: ["src/controller.ts"],
          gotcha: "Verification must pass before advancing",
          verification: "bun test passed",
        },
      ],
    });

    expect(prompt).toContain("Ship Goal Mode");
    expect(prompt).toContain("Preserve ACP permission boundaries");
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("bun test goal-mode");
    expect(prompt).toContain("Added controller state writes");
    expect(prompt).not.toContain(rawTranscript);
    expect(prompt).not.toContain(rawDiff);
  });

  test("clamps prompt size without adding raw history", () => {
    const prompt = buildGoalModeNextPrompt({
      goal: createGoal(),
      currentPhase: createPhase(),
      completedSummaries: [
        {
          keyDecision: "x".repeat(5000),
          filesChanged: ["src/controller.ts"],
          gotcha: "compact",
          verification: "passed",
        },
      ],
      maxChars: 800,
    });

    expect(prompt.length).toBeLessThanOrEqual(840);
    expect(prompt).toContain("[compact prompt truncated]");
  });
});
