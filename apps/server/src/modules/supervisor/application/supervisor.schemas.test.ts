import { describe, expect, test } from "bun:test";
import { SupervisorTurnDecisionSchema } from "./supervisor.schemas";

describe("SupervisorTurnDecisionSchema", () => {
  test("accepts continue decisions only with a follow-up prompt", () => {
    expect(
      SupervisorTurnDecisionSchema.safeParse({
        action: "continue",
        reason: "More work is required",
        followUpPrompt: "Continue the task and verify the result.",
      }).success
    ).toBe(true);

    const missingPrompt = SupervisorTurnDecisionSchema.safeParse({
      action: "continue",
      reason: "More work is required",
    });
    expect(missingPrompt.success).toBe(false);
  });

  test("rejects follow-up prompts on terminal decisions", () => {
    const parsed = SupervisorTurnDecisionSchema.safeParse({
      action: "done",
      reason: "The task is complete",
      followUpPrompt: "Keep going",
    });

    expect(parsed.success).toBe(false);
  });
});
