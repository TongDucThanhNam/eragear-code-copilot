import { describe, expect, test } from "bun:test";
import {
  parseBroadcastEventClientSafe,
  parseUiMessageArrayClientSafe,
  parseUiMessageClientSafe,
} from "./event-schema";

describe("parseUiMessageClientSafe", () => {
  test("keeps known parts and drops unknown parts", () => {
    const parsed = parseUiMessageClientSafe({
      id: "msg-1",
      role: "assistant",
      createdAt: 1234,
      parts: [
        { type: "text", text: "hello", state: "streaming" },
        { type: "experimental-part", payload: "ignored" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.parts).toEqual([
      { type: "text", text: "hello", state: "streaming" },
    ]);
    expect(parsed.value.createdAt).toBe(1234);
  });

  test("rejects invalid createdAt type", () => {
    const parsed = parseUiMessageClientSafe({
      id: "msg-1",
      role: "assistant",
      createdAt: "1234",
      parts: [{ type: "text", text: "hello", state: "streaming" }],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.kind).toBe("invalid_payload");
  });
});

describe("parseUiMessageArrayClientSafe", () => {
  test("fails when one item has an invalid message envelope", () => {
    const parsed = parseUiMessageArrayClientSafe([
      {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
      },
      {
        id: "msg-2",
        parts: [],
      },
    ]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.kind).toBe("invalid_payload");
  });
});

describe("parseBroadcastEventClientSafe", () => {
  test("classifies unknown event type without treating it as malformed", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "future_event",
      anything: true,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.kind).toBe("unknown_event");
  });

  test("sanitizes ui_message payload by dropping unknown parts", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message",
      turnId: "turn-1",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [
          { type: "experimental-part", value: "ignore me" },
          { type: "text", text: "final text", state: "done" },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "ui_message") {
      return;
    }
    expect(parsed.value.turnId).toBe("turn-1");
    expect(parsed.value.message.parts).toEqual([
      { type: "text", text: "final text", state: "done" },
    ]);
  });

  test("sanitizes chat_finish embedded message by dropping unknown parts", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "chat_finish",
      stopReason: "end_turn",
      finishReason: "stop",
      isAbort: false,
      messageId: "msg-1",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [
          { type: "text", text: "done" },
          { type: "unknown-ui-part", text: "ignore me" },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "chat_finish") {
      return;
    }
    expect(parsed.value.message?.parts).toEqual([
      { type: "text", text: "done" },
    ]);
  });

  test("sanitizes ui_message_part payload", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "part-1",
      partIndex: 1,
      part: {
        type: "tool-edit",
        toolCallId: "tool-1",
        state: "output-available",
        input: { path: "a.ts" },
        output: { ok: true },
      },
      isNew: true,
      turnId: "turn-2",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "ui_message_part") {
      return;
    }
    expect(parsed.value.part.type).toBe("tool-edit");
    expect(parsed.value.partIndex).toBe(1);
    expect(parsed.value.isNew).toBe(true);
    expect(parsed.value.partId).toBe("part-1");
    expect(parsed.value.turnId).toBe("turn-2");
  });

  test("accepts output-cancelled tool parts", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part",
      messageId: "msg-2",
      messageRole: "assistant",
      partIndex: 0,
      part: {
        type: "tool-bash",
        toolCallId: "tool-2",
        state: "output-cancelled",
        input: { cmd: "sleep 10" },
      },
      isNew: false,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "ui_message_part") {
      return;
    }
    expect(parsed.value.part).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-2",
      state: "output-cancelled",
    });
  });

  test("sanitizes ui_message_part_removed payload", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part_removed",
      messageId: "msg-3",
      messageRole: "assistant",
      partId: "tool-locations:tool-1",
      partIndex: 2,
      part: {
        type: "data-tool-locations",
        data: {
          toolCallId: "tool-1",
          locations: [{ path: "src/example.ts", line: 1 }],
        },
      },
      turnId: "turn-4",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "ui_message_part_removed") {
      return;
    }
    expect(parsed.value.part.type).toBe("data-tool-locations");
    expect(parsed.value.partId).toBe("tool-locations:tool-1");
    expect(parsed.value.turnId).toBe("turn-4");
  });

  test("parses terminal_output payload with optional turnId", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "terminal_output",
      terminalId: "term-1",
      data: "stdout",
      turnId: "turn-3",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "terminal_output") {
      return;
    }
    expect(parsed.value.turnId).toBe("turn-3");
  });

  test("parses current_mode_update diagnostics fields", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "current_mode_update",
      modeId: "code",
      reason: "agent_exit_plan_mode",
      metadata: {
        source: "tool_call",
        toolCallId: "tool-1",
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "current_mode_update") {
      return;
    }
    expect(parsed.value.reason).toBe("agent_exit_plan_mode");
    expect(parsed.value.metadata).toEqual({
      source: "tool_call",
      toolCallId: "tool-1",
    });
  });

  test("rejects ui_message_part payload with invalid partId", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "bad id with spaces",
      partIndex: 1,
      part: {
        type: "text",
        text: "hello",
      },
      isNew: true,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.kind).toBe("invalid_payload");
  });

  test("classifies malformed known event payload as invalid", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part",
      messageId: 123,
      messageRole: "assistant",
      partIndex: "0",
      part: { type: "text", text: "x", state: "streaming" },
      isNew: true,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.kind).toBe("invalid_payload");
  });

  test("parses current_model_update payload", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "current_model_update",
      modelId: "model-2",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "current_model_update") {
      return;
    }
    expect(parsed.value.modelId).toBe("model-2");
  });
});
