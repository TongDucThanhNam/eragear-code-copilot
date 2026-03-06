import { describe, expect, test } from "bun:test";
import { normalizeMessage, parseBroadcastEvent } from "./use-chat-normalize";

describe("use-chat normalize", () => {
  test("normalizeMessage keeps known parts and drops unknown parts", () => {
    const message = normalizeMessage({
      id: "msg-1",
      role: "assistant",
      parts: [
        { type: "text", text: "hello", state: "streaming" },
        { type: "future-part", payload: "ignore" },
      ],
    });

    expect(message.parts).toEqual([
      { type: "text", text: "hello", state: "streaming" },
    ]);
  });

  test("parseBroadcastEvent ignores unknown event types", () => {
    const parsed = parseBroadcastEvent({
      type: "future_event",
      value: 1,
    });

    expect(parsed).toEqual({ status: "ignored_unknown_event" });
  });

  test("parseBroadcastEvent classifies malformed known events as invalid payload", () => {
    const parsed = parseBroadcastEvent({
      type: "ui_message_part",
      messageId: 123,
      messageRole: "assistant",
      partIndex: "0",
      part: { type: "text", text: "x", state: "streaming" },
      isNew: true,
    });

    expect(parsed.status).toBe("invalid_payload");
  });

  test("parseBroadcastEvent sanitizes ui_message payload and keeps stream-compatible event", () => {
    const parsed = parseBroadcastEvent({
      type: "ui_message",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [
          { type: "text", text: "final", state: "done" },
          { type: "unknown-part", value: "ignore" },
        ],
      },
    });

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok" || parsed.event.type !== "ui_message") {
      return;
    }
    expect(parsed.event.message.parts).toEqual([
      { type: "text", text: "final", state: "done" },
    ]);
  });

  test("parseBroadcastEvent keeps ui_message_part payload", () => {
    const parsed = parseBroadcastEvent({
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "part-1",
      partIndex: 0,
      part: { type: "text", text: "hello", state: "streaming" },
      isNew: true,
    });

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok" || parsed.event.type !== "ui_message_part") {
      return;
    }
    expect(parsed.event.messageId).toBe("msg-1");
    expect(parsed.event.partId).toBe("part-1");
    expect(parsed.event.part.type).toBe("text");
  });
});
