import { describe, expect, test } from "bun:test";
import {
  assertPreparedSupervisorPrompt,
  computeSupervisorPromptHash,
  prepareSupervisorPrompt,
} from "./supervisor-effect-prompt-dispatch.port";

describe("prepared Supervisor prompts", () => {
  test("binds exact prompt text to its durable effect", () => {
    const prepared = prepareSupervisorPrompt({
      effectId: "effect-1",
      authorityId: "plan-1",
      text: "Inspect the current state and continue safely.",
    });

    expect(prepared.promptHash).toBe(
      computeSupervisorPromptHash(prepared.text)
    );
    expect(() =>
      assertPreparedSupervisorPrompt(prepared.text, prepared)
    ).not.toThrow();
  });

  test("rejects text or hash drift before ACP IO", () => {
    const prepared = prepareSupervisorPrompt({
      effectId: "effect-1",
      authorityId: "plan-1",
      text: "Original frozen prompt",
    });

    expect(() =>
      assertPreparedSupervisorPrompt("Mutated prompt", prepared)
    ).toThrow("does not match its canonical snapshot");
    expect(() =>
      assertPreparedSupervisorPrompt(prepared.text, {
        ...prepared,
        promptHash: "0".repeat(64),
      })
    ).toThrow("does not match its canonical snapshot");
  });
});
