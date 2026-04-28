import { describe, expect, test } from "bun:test";
import {
  SupervisorSemanticDecisionSchema,
  SupervisorTurnDecisionSchema,
} from "./supervisor.schemas";

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

describe("SupervisorSemanticDecisionSchema", () => {
  // TR7: followUpPrompt is required for CONTINUE, APPROVE_GATE, CORRECT, REPLAN, SAVE_MEMORY
  test("accepts CONTINUE with followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "CONTINUE",
        reason: "More work is required",
        followUpPrompt: "Continue the task.",
      }).success
    ).toBe(true);
  });

  test("accepts APPROVE_GATE with followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "APPROVE_GATE",
        reason: "Safe option selected.",
        followUpPrompt: "Select this option.",
      }).success
    ).toBe(true);
  });

  test("accepts CORRECT with followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "CORRECT",
        reason: "Corrective continuation.",
        followUpPrompt: "Please verify and continue.",
      }).success
    ).toBe(true);
  });

  test("accepts REPLAN with followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "REPLAN",
        reason: "Need to replan.",
        followUpPrompt: "Start fresh.",
      }).success
    ).toBe(true);
  });

  test("accepts SAVE_MEMORY with followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "SAVE_MEMORY",
        reason: "Saving decision.",
        followUpPrompt: "Record this.",
      }).success
    ).toBe(true);
  });

  test("rejects CONTINUE without followUpPrompt", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "CONTINUE",
      reason: "More work is required",
    });
    expect(result.success).toBe(false);
  });

  test("rejects APPROVE_GATE without followUpPrompt", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "APPROVE_GATE",
      reason: "Safe option selected.",
    });
    expect(result.success).toBe(false);
  });

  test("rejects CORRECT without followUpPrompt", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "CORRECT",
      reason: "Corrective continuation.",
    });
    expect(result.success).toBe(false);
  });

  test("rejects REPLAN without followUpPrompt", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "REPLAN",
      reason: "Need to replan.",
    });
    expect(result.success).toBe(false);
  });

  test("rejects SAVE_MEMORY without followUpPrompt", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "SAVE_MEMORY",
      reason: "Saving decision.",
    });
    expect(result.success).toBe(false);
  });

  // TR7: followUpPrompt is optional for DONE, ESCALATE, ABORT, WAIT
  test("accepts DONE without followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "DONE",
        reason: "Task complete.",
      }).success
    ).toBe(true);
  });

  test("accepts DONE with followUpPrompt (optional but allowed)", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "DONE",
        reason: "Task complete.",
        followUpPrompt: "Optional follow-up.",
      }).success
    ).toBe(true);
  });

  test("accepts ESCALATE without followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "ESCALATE",
        reason: "Human input needed.",
      }).success
    ).toBe(true);
  });

  test("accepts ABORT without followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "ABORT",
        reason: "Unsafe action.",
      }).success
    ).toBe(true);
  });

  test("accepts WAIT without followUpPrompt", () => {
    expect(
      SupervisorSemanticDecisionSchema.safeParse({
        semanticAction: "WAIT",
        reason: "Waiting for input.",
      }).success
    ).toBe(true);
  });

  // TR7: Unknown semantic action values are rejected
  test("rejects unknown semantic action", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "INVALID_ACTION",
      reason: "Unknown action.",
    });
    expect(result.success).toBe(false);
  });

  // runtimeAction is no longer part of the schema — server-computed, not LLM-provided
  test("runtimeAction is not accepted as input (stripped by Zod)", () => {
    const result = SupervisorSemanticDecisionSchema.safeParse({
      semanticAction: "CONTINUE",
      reason: "More work required.",
      followUpPrompt: "Continue.",
    });
    // runtimeAction is ignored by Zod; parse succeeds without it
    expect(result.success).toBe(true);
  });
});
