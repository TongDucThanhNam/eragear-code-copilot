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
    expect(parsed.value.message?.parts).toEqual([{ type: "text", text: "done" }]);
  });

  test("sanitizes ui_message_part payload", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 1,
      part: {
        type: "tool-edit",
        toolCallId: "tool-1",
        state: "output-available",
        input: { path: "a.ts" },
        output: { ok: true },
      },
      isNew: true,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== "ui_message_part") {
      return;
    }
    expect(parsed.value.part.type).toBe("tool-edit");
    expect(parsed.value.partIndex).toBe(1);
    expect(parsed.value.isNew).toBe(true);
  });

  test("classifies malformed known event payload as invalid", () => {
    const parsed = parseBroadcastEventClientSafe({
      type: "ui_message_delta",
      messageId: 123,
      partIndex: "0",
      delta: "x",
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
