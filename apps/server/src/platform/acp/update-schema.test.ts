import { describe, expect, test } from "bun:test";
import { parseSessionUpdatePayload } from "./update-schema";

describe("parseSessionUpdatePayload toolCallId validation", () => {
  test("accepts bounded tool_call ids", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "tool_call",
      toolCallId: "tool-call_01:exec",
      kind: "bash",
    });

    expect(parsed).not.toBeNull();
    if (parsed?.sessionUpdate === "tool_call") {
      expect(parsed.toolCallId).toBe("tool-call_01:exec");
    }
  });

  test("rejects tool_call ids containing whitespace", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "tool_call",
      toolCallId: "tool call 01",
      kind: "bash",
    });

    expect(parsed).toBeNull();
  });

  test("rejects oversized tool_call_update ids", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "tool_call_update",
      toolCallId: "a".repeat(257),
      status: "running",
    });

    expect(parsed).toBeNull();
  });
});
