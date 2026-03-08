import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import { buildUiMessagePartEvent } from "@/shared/utils/ui-message-part-event.util";
import { createUiMessageState, upsertToolLocationsPart } from "./state";

function createMessage(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    createdAt: Number.parseInt(id.replace("msg-", ""), 10) || 0,
    parts: [{ type: "text", text: id, state: "done" }],
  };
}

describe("createUiMessageState", () => {
  test("bounds runtime UI messages under sustained churn", () => {
    const state = createUiMessageState({ messageLimit: 64 });

    for (let index = 0; index < 10_000; index += 1) {
      const message = createMessage(`msg-${index}`);
      state.messages.set(message.id, message);
    }

    expect(state.messages.size).toBe(64);
    expect(state.messages.has("msg-0")).toBe(false);
    expect(state.messages.has("msg-9999")).toBe(true);
  });

  test("keeps heap growth bounded during long-running message churn", () => {
    const state = createUiMessageState({ messageLimit: 64 });
    const before = process.memoryUsage().heapUsed;

    for (let index = 0; index < 50_000; index += 1) {
      state.messages.set(`msg-${index}`, {
        id: `msg-${index}`,
        role: "assistant",
        createdAt: index,
        parts: [
          {
            type: "text",
            text: `${index}`.padEnd(512, "x"),
            state: "done",
          },
        ],
      });
    }

    Bun.gc?.(true);
    const after = process.memoryUsage().heapUsed;

    expect(state.messages.size).toBe(64);
    expect(after - before).toBeLessThan(64 * 1024 * 1024);
  });

  test("eviction clears part and tool indexes for removed messages", () => {
    const state = createUiMessageState({ messageLimit: 2 });
    const first = createMessage("msg-1");
    state.messages.set(first.id, first);
    const firstPartEvent = buildUiMessagePartEvent({
      state,
      message: first,
      partIndex: 0,
      isNew: true,
    });
    expect(firstPartEvent?.partId).toEqual(expect.any(String));
    state.toolPartIndex.set("tool-1", {
      messageId: first.id,
      partIndex: 0,
    });

    state.messages.set("msg-2", createMessage("msg-2"));
    state.messages.set("msg-3", createMessage("msg-3"));

    expect(state.messages.has(first.id)).toBe(false);
    expect(state.partIdIndex.has(first.id)).toBe(false);
    expect(state.toolPartIndex.has("tool-1")).toBe(false);
  });

  test("retains active message pointers when pruning older history", () => {
    const state = createUiMessageState({ messageLimit: 2 });
    state.messages.set("msg-1", createMessage("msg-1"));
    state.currentAssistantId = "msg-1";

    state.messages.set("msg-2", createMessage("msg-2"));
    state.messages.set("msg-3", createMessage("msg-3"));

    expect(state.messages.has("msg-1")).toBe(true);
    expect(state.messages.has("msg-2")).toBe(false);
    expect(state.messages.has("msg-3")).toBe(true);
  });

  test("keeps sparse part ids stable when an earlier index is filled later", () => {
    const state = createUiMessageState();
    const message: UIMessage = {
      id: "msg-parts",
      role: "assistant",
      createdAt: 1,
      parts: [
        { type: "text", text: "first", state: "done" },
        { type: "text", text: "second", state: "done" },
      ],
    };

    const secondPartCreated = buildUiMessagePartEvent({
      state,
      message,
      partIndex: 1,
      isNew: true,
    });
    const firstPartCreated = buildUiMessagePartEvent({
      state,
      message,
      partIndex: 0,
      isNew: true,
    });
    const secondPartUpdated = buildUiMessagePartEvent({
      state,
      message,
      partIndex: 1,
      isNew: false,
    });

    expect(secondPartCreated?.partId).toEqual(expect.any(String));
    expect(firstPartCreated?.partId).toEqual(expect.any(String));
    expect(secondPartUpdated?.partId).toBe(secondPartCreated?.partId);
    expect(firstPartCreated?.partId).not.toBe(secondPartCreated?.partId);
  });

  test("reuses intrinsic ids when a tool part moves to a later index", () => {
    const state = createUiMessageState();
    const initialMessage: UIMessage = {
      id: "msg-tool",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "tool-1",
          state: "input-available",
          input: {},
        },
      ],
    };
    const movedMessage: UIMessage = {
      ...initialMessage,
      parts: [
        { type: "text", text: "lead", state: "done" },
        initialMessage.parts[0]!,
      ],
    };

    const initialToolEvent = buildUiMessagePartEvent({
      state,
      message: initialMessage,
      partIndex: 0,
      isNew: true,
    });
    const movedToolEvent = buildUiMessagePartEvent({
      state,
      message: movedMessage,
      partIndex: 1,
      isNew: false,
    });

    expect(initialToolEvent?.partId).toEqual(expect.any(String));
    expect(movedToolEvent?.partId).toBe(initialToolEvent?.partId);
  });

  test("shifts part ids after removing a tool-locations part", () => {
    const state = createUiMessageState();
    const message: UIMessage = {
      id: "msg-delete-locations",
      role: "assistant",
      createdAt: 1,
      parts: [
        { type: "text", text: "lead", state: "done" },
        {
          type: "data-tool-locations",
          data: {
            toolCallId: "tool-1",
            locations: [{ path: "src/example.ts", line: 1 }],
          },
        },
        { type: "text", text: "tail", state: "done" },
      ],
    };
    state.messages.set(message.id, message);
    state.toolPartIndex.set("tool-1", {
      messageId: message.id,
      partIndex: 0,
    });

    const locationEvent = buildUiMessagePartEvent({
      state,
      message,
      partIndex: 1,
      isNew: true,
    });
    const trailingEvent = buildUiMessagePartEvent({
      state,
      message,
      partIndex: 2,
      isNew: true,
    });

    const updatedMessage = upsertToolLocationsPart({
      state,
      toolCallId: "tool-1",
      locations: null,
      messageId: message.id,
    });
    if (!updatedMessage) {
      throw new Error("Expected updated message after deleting tool locations");
    }

    const shiftedTrailingEvent = buildUiMessagePartEvent({
      state,
      message: updatedMessage,
      partIndex: 1,
      isNew: false,
    });

    expect(locationEvent?.partId).toEqual(expect.any(String));
    expect(trailingEvent?.partId).toEqual(expect.any(String));
    expect(shiftedTrailingEvent?.partId).toBe(trailingEvent?.partId);
    expect(shiftedTrailingEvent?.partId).not.toBe(locationEvent?.partId);
  });

  test("shifts later tool indexes after removing a middle part", () => {
    const state = createUiMessageState();
    const message: UIMessage = {
      id: "msg-delete-middle",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          type: "tool-bash",
          toolCallId: "tool-1",
          state: "input-available",
          input: { cmd: "pwd" },
        },
        {
          type: "data-tool-locations",
          data: {
            toolCallId: "tool-1",
            locations: [{ path: "src/example.ts", line: 1 }],
          },
        },
        {
          type: "tool-read",
          toolCallId: "tool-2",
          state: "input-available",
          input: { path: "src/example.ts" },
        },
      ],
    };
    state.messages.set(message.id, message);
    state.toolPartIndex.set("tool-1", {
      messageId: message.id,
      partIndex: 0,
    });
    state.toolPartIndex.set("tool-2", {
      messageId: message.id,
      partIndex: 2,
    });

    const updatedMessage = upsertToolLocationsPart({
      state,
      toolCallId: "tool-1",
      locations: null,
      messageId: message.id,
    });
    if (!updatedMessage) {
      throw new Error("Expected updated message after deleting tool locations");
    }

    expect(updatedMessage.parts).toHaveLength(2);
    expect(state.toolPartIndex.get("tool-1")?.partIndex).toBe(0);
    expect(state.toolPartIndex.get("tool-2")?.partIndex).toBe(1);
  });
});
