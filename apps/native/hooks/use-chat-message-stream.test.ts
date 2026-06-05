import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import {
  applyPartUpdateToMessage,
  shouldDeferStreamingPartUpdate,
} from "./use-chat-message-stream";

describe("use-chat-message-stream", () => {
  test("defers active streaming textual parts", () => {
    const current: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "hel", state: "streaming" }],
    };

    expect(
      shouldDeferStreamingPartUpdate({
        current,
        partIndex: 0,
        part: { type: "text", text: "hello", state: "streaming" },
      })
    ).toBe(true);
  });

  test("applies completed textual parts immediately", () => {
    const current: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "hel", state: "streaming" }],
    };

    expect(
      shouldDeferStreamingPartUpdate({
        current,
        partIndex: 0,
        part: { type: "text", text: "hello", state: "done" },
      })
    ).toBe(false);
  });

  test("does not defer late tail updates that extend finalized text", () => {
    const current: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "prefix-", state: "done" }],
    };

    expect(
      shouldDeferStreamingPartUpdate({
        current,
        partIndex: 0,
        part: { type: "text", text: "prefix-tail", state: "streaming" },
      })
    ).toBe(false);
  });

  test("checks late tail updates by stable part id when index has shifted", () => {
    const current: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "plan",
          state: "done",
          id: "part-a",
        } as unknown as UIMessage["parts"][number],
        {
          type: "text",
          text: "prefix-",
          state: "done",
          id: "part-b",
        } as unknown as UIMessage["parts"][number],
      ],
    };

    expect(
      shouldDeferStreamingPartUpdate({
        current,
        partId: "part-b",
        partIndex: 0,
        part: { type: "text", text: "prefix-tail", state: "streaming" },
      })
    ).toBe(false);
  });

  test("updates parts by stable part id when index has shifted", () => {
    const reasoningPart = {
      type: "reasoning",
      text: "plan",
      state: "done",
      id: "part-a",
    } as unknown as UIMessage["parts"][number];
    const textPart = {
      type: "text",
      text: "draft",
      state: "streaming",
      id: "part-b",
    } as unknown as UIMessage["parts"][number];
    const current: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [reasoningPart, textPart],
    };

    const updated = applyPartUpdateToMessage(current, {
      messageId: "assistant-1",
      messageRole: "assistant",
      partId: "part-b",
      partIndex: 0,
      part: { type: "text", text: "done", state: "done" },
      isNew: false,
    });

    expect(updated?.parts[0]).toEqual(reasoningPart);
    expect(updated?.parts[1]).toMatchObject({
      type: "text",
      text: "done",
      state: "done",
    });
    expect((updated?.parts[1] as { id?: string } | undefined)?.id).toBe(
      "part-b"
    );
  });
});
