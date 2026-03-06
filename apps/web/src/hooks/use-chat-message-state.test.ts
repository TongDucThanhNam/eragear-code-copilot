import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import {
  applyPartUpdate,
  createEmptyMessageState,
  finalizeStreamingMessagesInState,
  mergeMessagesIntoState,
  prependMessagesIntoState,
  replaceMessagesState,
} from "./use-chat-message-state";

function createMessage(
  id: string,
  text: string,
  role: UIMessage["role"] = "assistant",
  createdAt?: number
): UIMessage {
  return {
    id,
    role,
    ...(typeof createdAt === "number" ? { createdAt } : {}),
    parts: [{ type: "text", text, state: "done" }],
  };
}

describe("use-chat-message-state", () => {
  test("merge preserves order and updates message in place by index", () => {
    const initial = replaceMessagesState([
      createMessage("m1", "one"),
      createMessage("m2", "two"),
    ]);

    const updated = mergeMessagesIntoState(initial, [
      createMessage("m2", "two-updated"),
    ]);

    expect(updated.order).toEqual(["m1", "m2"]);
    expect(updated.orderedMessages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(updated.orderedMessages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "two-updated",
    });
    expect(updated.indexById.get("m1")).toBe(0);
    expect(updated.indexById.get("m2")).toBe(1);
  });

  test("merge appends unknown messages at the end", () => {
    const initial = replaceMessagesState([createMessage("m1", "one")]);
    const updated = mergeMessagesIntoState(initial, [
      createMessage("m2", "two"),
    ]);

    expect(updated.order).toEqual(["m1", "m2"]);
    expect(updated.orderedMessages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(updated.indexById.get("m2")).toBe(1);
  });

  test("merge inserts late user before trailing assistant by createdAt", () => {
    const initial = replaceMessagesState([
      createMessage("m1", "user-1", "user", 1000),
      createMessage("m2", "ai-1", "assistant", 1100),
      createMessage("m3", "ai-2", "assistant", 2000),
    ]);

    const updated = mergeMessagesIntoState(initial, [
      createMessage("m4", "user-2", "user", 1500),
    ]);

    expect(updated.order).toEqual(["m1", "m2", "m4", "m3"]);
    expect(updated.indexById.get("m4")).toBe(2);
    expect(updated.indexById.get("m3")).toBe(3);
  });

  test("merge keeps deterministic tie-break when createdAt is equal", () => {
    const initial = replaceMessagesState([
      createMessage("m1", "assistant", "assistant", 1000),
    ]);
    const updated = mergeMessagesIntoState(initial, [
      createMessage("m2", "user", "user", 1000),
    ]);

    expect(updated.order).toEqual(["m2", "m1"]);
  });

  test("prepend inserts only unknown messages at start and updates known message", () => {
    const initial = replaceMessagesState([
      createMessage("m2", "two"),
      createMessage("m3", "three"),
    ]);

    const updated = prependMessagesIntoState(initial, [
      createMessage("m1", "one"),
      createMessage("m2", "two-updated"),
    ]);

    expect(updated.order).toEqual(["m1", "m2", "m3"]);
    expect(updated.orderedMessages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    expect(updated.orderedMessages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "two-updated",
    });
    expect(updated.indexById.get("m1")).toBe(0);
    expect(updated.indexById.get("m2")).toBe(1);
    expect(updated.indexById.get("m3")).toBe(2);
  });

  test("replace builds deterministic index and order", () => {
    const replaced = replaceMessagesState([
      createMessage("m1", "one"),
      createMessage("m1", "one-newer"),
      createMessage("m2", "two"),
    ]);

    expect(replaced.order).toEqual(["m1", "m2"]);
    expect(replaced.orderedMessages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(replaced.orderedMessages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "one-newer",
    });
    expect(replaced.indexById.get("m1")).toBe(0);
    expect(replaced.indexById.get("m2")).toBe(1);
  });

  test("empty merge keeps references stable", () => {
    const empty = createEmptyMessageState();
    const next = mergeMessagesIntoState(empty, []);
    expect(next).toBe(empty);
  });

  test("applyPartUpdate appends a new part to an existing message", () => {
    const initial = replaceMessagesState([createMessage("m1", "one")]);
    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 1,
      part: { type: "reasoning", text: "plan", state: "done" },
      isNew: true,
    });

    expect(updated.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "one", state: "done" },
      { type: "reasoning", text: "plan", state: "done" },
    ]);
  });

  test("applyPartUpdate replaces one part in an existing message", () => {
    const initial = replaceMessagesState([createMessage("m1", "one")]);
    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "one-updated", state: "done" },
      isNew: false,
    });

    expect(updated.byId.get("m1")?.parts[0]).toEqual({
      type: "text",
      text: "one-updated",
      state: "done",
    });
  });

  test("applyPartUpdate does not drop isNew part when partIndex exceeds array length (OOO)", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);

    // Simulate out-of-order: partIndex 2 arrives before partIndex 1
    const afterPart2 = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 2,
      part: { type: "text", text: "part-2", state: "done" },
      isNew: true,
    });

    // Part should be appended (not dropped)
    expect(afterPart2.byId.get("m1")?.parts).toHaveLength(2);
    expect(afterPart2.byId.get("m1")?.parts[1]).toMatchObject({
      type: "text",
      text: "part-2",
    });

    // Now partIndex 1 arrives
    const afterPart1 = applyPartUpdate(afterPart2, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 1,
      part: { type: "reasoning", text: "thinking", state: "done" },
      isNew: true,
    });

    // All three parts present — no data loss
    expect(afterPart1.byId.get("m1")?.parts).toHaveLength(3);
    // Existing indices remain stable to avoid UI reflow from index shifting.
    expect(afterPart1.byId.get("m1")?.parts[1]).toMatchObject({
      type: "text",
      text: "part-2",
    });
    expect(afterPart1.byId.get("m1")?.parts[2]).toMatchObject({
      type: "reasoning",
      text: "thinking",
    });
  });

  test("applyPartUpdate keeps idempotent isNew collisions stable", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);
    const first = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 1,
      part: { type: "reasoning", text: "thinking", state: "done" },
      isNew: true,
    });
    const second = applyPartUpdate(first, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 1,
      part: { type: "reasoning", text: "thinking", state: "done" },
      isNew: true,
    });

    expect(second.byId.get("m1")?.parts).toHaveLength(2);
    expect(second.byId.get("m1")?.parts[1]).toMatchObject({
      type: "reasoning",
      text: "thinking",
    });
    expect(second).toBe(first);
  });

  test("applyPartUpdate ignores non-new update for out-of-bounds index", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);

    // Simulate non-new update for partIndex 3 when there's only 1 part
    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 3,
      part: { type: "text", text: "late-update", state: "done" },
      isNew: false,
    });

    // Ignore invalid out-of-bounds non-new updates and wait for snapshot sync.
    expect(updated).toBe(initial);
    expect(updated.byId.get("m1")?.parts).toHaveLength(1);
  });

  test("applyPartUpdate ignores stale reconnect replay that would downgrade part-0", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "100 tokens", state: "streaming" }],
      },
    ]);

    const afterStaleIsNew = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "1", state: "streaming" },
      isNew: true,
    });
    expect(afterStaleIsNew).toBe(initial);

    const afterStaleUpdate = applyPartUpdate(afterStaleIsNew, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "12", state: "streaming" },
      isNew: false,
    });
    expect(afterStaleUpdate).toBe(initial);
    expect(afterStaleUpdate.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "100 tokens", state: "streaming" },
    ]);
  });

  test("applyPartUpdate stores server partId for stable client keys", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "one", state: "streaming" }],
      },
    ]);
    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "part-msg1-0",
      partIndex: 0,
      part: { type: "text", text: "one-updated", state: "streaming" },
      isNew: false,
    });

    const storedPart = updated.byId.get("m1")?.parts[0];
    expect(storedPart).toMatchObject({
      type: "text",
      text: "one-updated",
      state: "streaming",
    });
    expect((storedPart as { id?: unknown } | undefined)?.id).toBe("part-msg1-0");
  });

  test("applyPartUpdate still drops negative partIndex", () => {
    const initial = replaceMessagesState([createMessage("m1", "one")]);

    const resultNew = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: -1,
      part: { type: "text", text: "bad", state: "done" },
      isNew: true,
    });
    expect(resultNew).toBe(initial);

    const resultUpdate = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: -1,
      part: { type: "text", text: "bad", state: "done" },
      isNew: false,
    });
    expect(resultUpdate).toBe(initial);
  });

  test("finalizeStreamingMessagesInState closes lingering text/reasoning streams", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking", state: "streaming" },
          { type: "text", text: "answer", state: "streaming" },
        ],
      },
    ]);

    const finalized = finalizeStreamingMessagesInState(initial);
    expect(finalized.byId.get("m1")?.parts).toEqual([
      { type: "reasoning", text: "thinking", state: "done" },
      { type: "text", text: "answer", state: "done" },
    ]);
  });

  test("finalizeStreamingMessagesInState finalizes active tool parts", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "input-available",
            input: { cmd: "ls" },
          },
        ],
      },
    ]);

    const finalized = finalizeStreamingMessagesInState(initial);
    expect(finalized.byId.get("m1")?.parts[0]).toEqual({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "output-available",
      input: { cmd: "ls" },
      output: null,
      preliminary: true,
    });
  });

  test("finalizeStreamingMessagesInState cancels stale approval-requested tool parts", () => {
    const initial = replaceMessagesState([
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-2",
            state: "approval-requested",
            input: { cmd: "rm -rf /tmp/demo" },
            approval: { id: "req-1" },
          },
        ],
      },
    ]);

    const finalized = finalizeStreamingMessagesInState(initial);
    expect(finalized.byId.get("m2")?.parts[0]).toEqual({
      type: "tool-bash",
      toolCallId: "tool-2",
      state: "output-cancelled",
      input: { cmd: "rm -rf /tmp/demo" },
      approval: {
        id: "req-1",
        approved: false,
        reason: "cancelled",
      },
    });
  });
});
