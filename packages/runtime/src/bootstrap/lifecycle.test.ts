import { describe, expect, test } from "bun:test";
import { KNOWN_WORKFLOW_EFFECT_TYPES } from "#runtime/modules/workflow";
import { reconcileWorkflowJournalAfterRestart } from "./lifecycle";

describe("workflow journal startup recovery", () => {
  test("releases pre-IO claims before making every known started effect uncertain", async () => {
    const calls: string[] = [];
    let uncertainInput: unknown;

    const result = await reconcileWorkflowJournalAfterRestart(
      {
        releasePendingEffectClaims(input) {
          calls.push(`release:${input.nowMs}`);
          return Promise.resolve([]);
        },
        markStaleStartedDispatchesUncertain(input) {
          calls.push(`uncertain:${input.nowMs}`);
          uncertainInput = input;
          return Promise.resolve([]);
        },
      },
      1234
    );

    expect(calls).toEqual(["release:1234", "uncertain:1234"]);
    expect(uncertainInput).toEqual({
      effectTypes: [...KNOWN_WORKFLOW_EFFECT_TYPES],
      nowMs: 1234,
      includeUnexpired: true,
      error: {
        kind: "runtime_restart",
        message:
          "The runtime restarted after this workflow effect started; reconcile external state and durable evidence before continuing.",
      },
    });
    expect(KNOWN_WORKFLOW_EFFECT_TYPES).toHaveLength(13);
    expect(result).toEqual({ releasedEffects: [], uncertainEffects: [] });
  });
});
