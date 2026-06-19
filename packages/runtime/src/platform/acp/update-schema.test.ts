import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { parseSessionUpdatePayload } from "./update-schema";

describe("parseSessionUpdatePayload toolCallId validation", () => {
  afterEach(() => {
    (
      console.warn as typeof console.warn & { mockRestore?: () => void }
    ).mockRestore?.();
  });

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

  test("logs validation failures for known update kinds instead of silently dropping them", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "current_mode_update",
      modeId: 123,
    });

    expect(parsed).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(loggedMessage).toContain(
      "ACP known session update validation failed"
    );
    expect(loggedMessage).toContain('"updateKind":"current_mode_update"');
    expect(loggedMessage).toContain("schema validation failed");
  });

  test("rejects oversized plan entry content", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "plan",
      entries: [
        {
          content: "x".repeat(16_385),
          priority: "high",
          status: "pending",
        },
      ],
    });

    expect(parsed).toBeNull();
  });

  test("rejects oversized available command descriptions", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: "lint",
          description: "x".repeat(4097),
        },
      ],
    });

    expect(parsed).toBeNull();
  });

  test("rejects oversized wrapped chunk content strings", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "content",
        content: "x".repeat(16_385),
      },
    });

    expect(parsed).toBeNull();
  });

  test("accepts current_mode_update diagnostics fields", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "current_mode_update",
      modeId: "code",
      reason: "agent_exit_plan_mode",
      metadata: {
        source: "tool_call",
        toolCallId: "tool-1",
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      sessionUpdate: "current_mode_update",
      currentModeId: "code",
      reason: "agent_exit_plan_mode",
      metadata: {
        source: "tool_call",
        toolCallId: "tool-1",
      },
    });
  });
});
