import { describe, expect, test } from "bun:test";
import { stripThinkingBlocks } from "./ai-sdk-supervisor-chat.adapter";

describe("stripThinkingBlocks", () => {
  test("removes MiniMax thinking blocks before side-chat display", () => {
    const content = stripThinkingBlocks(
      "<think>private reasoning</think>\n\nSupervisor is enabled, but autopilot is off."
    );

    expect(content).toBe("Supervisor is enabled, but autopilot is off.");
    expect(content).not.toContain("<think>");
    expect(content).not.toContain("private reasoning");
  });

  test("fails closed for an unterminated thinking block", () => {
    expect(stripThinkingBlocks("<think>private reasoning")).toBe("");
  });
});
