import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../ui-message";
import { applySessionState, processSessionEvent } from "./use-chat-core";
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
      partIndex: 0,
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

  test("applies reasoning delta to the indexed reasoning part", () => {
    const initialMessage = createAssistantMessage("msg-1", [
      { type: "reasoning", text: "Step 1", state: "streaming" },
      { type: "text", text: "Answer", state: "streaming" },
      { type: "reasoning", text: " / Step 2", state: "streaming" },
    ]);
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 0,
      delta: " / Step 3",
    };

    const next = processSessionEvent(event, [initialMessage], null, {});
    expect(next).toHaveLength(1);
    expect(next[0]?.parts[0]).toEqual({
      type: "reasoning",
      text: "Step 1 / Step 3",
      state: "streaming",
    });
    expect(next[0]?.parts[2]).toEqual({
      type: "reasoning",
      text: " / Step 2",
      state: "streaming",
    });
  });

  test("ignores delta updates when target message is missing", () => {
    const currentMessages: UIMessage[] = [];
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "missing",
      partIndex: 0,
      delta: "x",
    };

    const next = processSessionEvent(event, currentMessages, null, {});
    expect(next).toBe(currentMessages);
    expect(next).toEqual([]);
  });

  test("ignores delta updates when target part index is invalid", () => {
    const currentMessages: UIMessage[] = [
      createAssistantMessage("msg-1", [{ type: "text", text: "a", state: "streaming" }]),
    ];
    const event: BroadcastEvent = {
      type: "ui_message_delta",
      messageId: "msg-1",
      partIndex: 5,
      delta: "x",
    };
    const next = processSessionEvent(event, currentMessages, null, {});
    expect(next).toBe(currentMessages);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "a",
      state: "streaming",
    });
  });
});

describe("processSessionEvent config/session-info updates", () => {
  test("forwards config options updates", () => {
    const configOptions = [
      {
        id: "mode",
        name: "Mode",
        type: "select" as const,
        currentValue: "code",
        options: [{ value: "code", name: "Code" }],
      },
    ];
    const event: BroadcastEvent = {
      type: "config_options_update",
      configOptions,
    };
    const received: typeof configOptions[] = [];
    const next = processSessionEvent(event, [], null, {
      onConfigOptionsChange: (options) => {
        received.push(options);
      },
    });
    expect(next).toEqual([]);
    expect(received).toEqual([configOptions]);
  });

  test("applies session info from session state snapshot", () => {
    let info: { title?: string | null; updatedAt?: string | null } | null = null;
    const connected = applySessionState(
      {
        status: "running",
        sessionInfo: { title: "Agent title" },
      },
      {
        onSessionInfoChange: (nextInfo) => {
          info = nextInfo;
        },
      }
    );
    expect(connected).toBe(true);
    expect(info).toEqual({ title: "Agent title" });
  });
});
