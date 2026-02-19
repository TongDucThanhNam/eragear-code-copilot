import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../ui-message";
import { processSessionEvent } from "./use-chat-core";
import type { BroadcastEvent } from "./types";

function createAssistantMessage(
  id: string,
  parts: UIMessage["parts"]
): UIMessage {
  return {
    id,
    role: "assistant",
    parts,
  };
}

describe("processSessionEvent ui_message_delta", () => {
  test("applies text delta to the existing assistant message", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "text", text: "Hello", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partType: "text",
      delta: " world",
    };

    const next = processSessionEvent(event, [initialMessage], null, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "Hello world",
      state: "streaming",
    });
  });

  test("applies reasoning delta to the latest reasoning part", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "reasoning", text: "Step 1", state: "streaming" },
      { type: "text", text: "Answer", state: "streaming" },
      { type: "reasoning", text: " / Step 2", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partType: "reasoning",
      delta: " / Step 3",
    };

    const next = processSessionEvent(event, [initialMessage], null, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.parts[2]).toEqual({
      type: "reasoning",
      text: " / Step 2 / Step 3",
      state: "streaming",
    });
  });

  test("ignores delta updates when target message is missing", () => {
    const currentMessages: UIMessage[] = [];
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "missing",
      partType: "text",
      delta: "x",
    };

    const next = processSessionEvent(event, currentMessages, null, {});
    expect(next).toBe(currentMessages);
    expect(next).toEqual([]);
  });
});
