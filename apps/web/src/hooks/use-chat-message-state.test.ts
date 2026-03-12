import { describe, expect, test } from "bun:test";
import { findPendingPermission, type UIMessage } from "@repo/shared";
import {
  applyPartRemoval,
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

  test("merge preserves live approval-requested parts when stale snapshot omits them", () => {
    const initial = replaceMessagesState([
      {
        id: "m-permission",
        role: "assistant",
        parts: [
          { type: "text", text: "checking", state: "done" },
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "approval-requested",
            input: { cmd: "cat secrets.txt" },
            approval: { id: "req-1" },
          },
          {
            type: "data-permission-options",
            data: {
              requestId: "req-1",
              options: [{ id: "allow-once", label: "Allow once" }],
            },
          },
        ],
      },
    ]);

    const updated = mergeMessagesIntoState(initial, [
      {
        id: "m-permission",
        role: "assistant",
        parts: [{ type: "text", text: "checking", state: "done" }],
      },
    ]);

    expect(updated.byId.get("m-permission")?.parts).toEqual([
      { type: "text", text: "checking", state: "done" },
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "approval-requested",
        input: { cmd: "cat secrets.txt" },
        approval: { id: "req-1" },
      },
      {
        type: "data-permission-options",
        data: {
          requestId: "req-1",
          options: [{ id: "allow-once", label: "Allow once" }],
        },
      },
    ]);
  });

  test("merge accepts newer final tool snapshot over older approval-requested state", () => {
    const initial = replaceMessagesState([
      {
        id: "m-tool",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "approval-requested",
            input: { cmd: "ls" },
            approval: { id: "req-1" },
          },
        ],
      },
    ]);

    const updated = mergeMessagesIntoState(initial, [
      {
        id: "m-tool",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "output-available",
            input: { cmd: "ls" },
            output: { exitCode: 0 },
          },
        ],
      },
    ]);

    expect(updated.byId.get("m-tool")?.parts[0]).toEqual({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "output-available",
      input: { cmd: "ls" },
      output: { exitCode: 0 },
    });
  });

  test("merge lets authoritative snapshot correct mismatched part order", () => {
    const initial = replaceMessagesState([
      {
        id: "m-order",
        role: "assistant",
        parts: [
          { type: "text", text: "answer", state: "done" },
          { type: "text", text: "tool output", state: "done" },
          { type: "reasoning", text: "thinking", state: "done" },
        ],
      },
    ]);

    const updated = mergeMessagesIntoState(initial, [
      {
        id: "m-order",
        role: "assistant",
        parts: [
          { type: "text", text: "answer", state: "done" },
          { type: "reasoning", text: "thinking", state: "done" },
          { type: "text", text: "tool output", state: "done" },
        ],
      },
    ]);

    expect(updated.byId.get("m-order")?.parts).toEqual([
      { type: "text", text: "answer", state: "done" },
      { type: "reasoning", text: "thinking", state: "done" },
      { type: "text", text: "tool output", state: "done" },
    ]);
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

  test("applyPartUpdate accepts late longer streaming text after local done finalize", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Game nam o", state: "done" }],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: {
        type: "text",
        text: "Game nam o `demos/whack-mole-game/`",
        state: "streaming",
      },
      isNew: false,
    });

    expect(updated.byId.get("m1")?.parts[0]).toEqual({
      type: "text",
      text: "Game nam o `demos/whack-mole-game/`",
      state: "streaming",
    });

    const finalized = finalizeStreamingMessagesInState(updated);
    expect(finalized.byId.get("m1")?.parts[0]).toEqual({
      type: "text",
      text: "Game nam o `demos/whack-mole-game/`",
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

  test("applyPartUpdate recovers out-of-bounds non-new text update when partId is present", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "part-text-tail-1",
      partIndex: 3,
      part: { type: "text", text: "tail", state: "streaming" },
      isNew: false,
    });

    expect(updated).not.toBe(initial);
    const parts = updated.byId.get("m1")?.parts;
    expect(parts).toHaveLength(2);
    expect(parts?.[1]).toEqual({
      type: "text",
      text: "tail",
      state: "streaming",
      id: "part-text-tail-1",
    });

    const replayed = applyPartUpdate(updated, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "part-text-tail-1",
      partIndex: 4,
      part: { type: "text", text: "tail", state: "streaming" },
      isNew: false,
    });
    expect(replayed).toBe(updated);
    expect(replayed.byId.get("m1")?.parts).toHaveLength(2);
  });

  test("applyPartUpdate recovers missing tool part for out-of-bounds non-new approval update", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "tool:recover-1",
      partIndex: 5,
      part: {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "approval-requested",
        input: { cmd: "ls" },
        approval: { id: "req-1" },
      },
      isNew: false,
    });

    expect(updated).not.toBe(initial);
    const parts = updated.byId.get("m1")?.parts;
    expect(parts).toHaveLength(2);
    expect(parts?.[0]).toEqual({ type: "text", text: "part-0", state: "done" });
    expect(parts?.[1]).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "approval-requested",
      input: { cmd: "ls" },
      approval: { id: "req-1" },
    });
    expect((parts?.[1] as { id?: unknown } | undefined)?.id).toBe(
      "tool:recover-1"
    );
  });

  test("applyPartUpdate recovers missing permission-options part for out-of-bounds non-new update", () => {
    const initial = replaceMessagesState([createMessage("m1", "part-0")]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "permission:recover-1",
      partIndex: 6,
      part: {
        type: "data-permission-options",
        data: {
          requestId: "req-1",
          options: [{ id: "allow-once", label: "Allow once" }],
        },
      },
      isNew: false,
    });

    expect(updated).not.toBe(initial);
    expect(updated.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "part-0", state: "done" },
      {
        id: "permission:recover-1",
        type: "data-permission-options",
        data: {
          requestId: "req-1",
          options: [{ id: "allow-once", label: "Allow once" }],
        },
      },
    ]);
  });

  test("applyPartUpdate matches non-new tool update by part identity when index drifted", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "part-0", state: "done" },
          {
            type: "tool-bash" as const,
            toolCallId: "tool-1",
            state: "input-available" as const,
            input: { cmd: "ls" },
            id: "tool:stable-1",
          } as UIMessage["parts"][number],
        ],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "tool:stable-1",
      partIndex: 8,
      part: {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "approval-requested",
        input: { cmd: "ls" },
        approval: { id: "req-1" },
      },
      isNew: false,
    });

    const parts = updated.byId.get("m1")?.parts;
    expect(parts).toHaveLength(2);
    expect(parts?.[0]).toEqual({ type: "text", text: "part-0", state: "done" });
    expect(parts?.[1]).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "approval-requested",
      input: { cmd: "ls" },
      approval: { id: "req-1" },
    });
    expect((parts?.[1] as { id?: unknown } | undefined)?.id).toBe(
      "tool:stable-1"
    );
  });

  test("applyPartUpdate recovers in-bounds tool update when local part type drifted", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "part-0", state: "done" },
          { type: "reasoning", text: "thinking", state: "done" },
        ],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "tool:recover-in-bounds",
      partIndex: 1,
      part: {
        type: "tool-bash",
        toolCallId: "tool-2",
        state: "approval-requested",
        input: { cmd: "pwd" },
        approval: { id: "req-2" },
      },
      isNew: false,
    });

    const parts = updated.byId.get("m1")?.parts;
    expect(parts).toHaveLength(3);
    expect(parts?.[1]).toEqual({
      type: "reasoning",
      text: "thinking",
      state: "done",
    });
    expect(parts?.[2]).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-2",
      state: "approval-requested",
      input: { cmd: "pwd" },
      approval: { id: "req-2" },
    });
    expect((parts?.[2] as { id?: unknown } | undefined)?.id).toBe(
      "tool:recover-in-bounds"
    );
  });

  test("applyPartUpdate recovers in-bounds permission-options update when local part type drifted", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "part-0", state: "done" },
          { type: "reasoning", text: "thinking", state: "done" },
        ],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "permission:recover-in-bounds",
      partIndex: 1,
      part: {
        type: "data-permission-options",
        data: {
          requestId: "req-2",
          options: [{ id: "allow-once", label: "Allow once" }],
        },
      },
      isNew: false,
    });

    const parts = updated.byId.get("m1")?.parts;
    expect(parts).toHaveLength(3);
    expect(parts?.[1]).toEqual({
      type: "reasoning",
      text: "thinking",
      state: "done",
    });
    expect(parts?.[2]).toEqual({
      id: "permission:recover-in-bounds",
      type: "data-permission-options",
      data: {
        requestId: "req-2",
        options: [{ id: "allow-once", label: "Allow once" }],
      },
    });
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

  test("mergeMessagesIntoState accepts longer streaming snapshot after done part", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "short", state: "done" }],
      },
    ]);

    const merged = mergeMessagesIntoState(initial, [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "short + tail", state: "streaming" }],
      },
    ]);

    expect(merged.byId.get("m1")?.parts[0]).toEqual({
      type: "text",
      text: "short + tail",
      state: "streaming",
    });
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
    expect((storedPart as { id?: unknown } | undefined)?.id).toBe(
      "part-msg1-0"
    );
  });

  test("applyPartRemoval removes tool-locations and preserves shifted tail updates", () => {
    const leadPart = {
      type: "text",
      text: "lead",
      state: "done",
      id: "part-lead",
    } as UIMessage["parts"][number];
    const tailPart = {
      type: "text",
      text: "tail",
      state: "done",
      id: "part-tail",
    } as UIMessage["parts"][number];
    let state = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          leadPart,
          {
            type: "data-tool-locations",
            id: "tool-locations:tool-1",
            data: {
              toolCallId: "tool-1",
              locations: [{ path: "src/example.ts", line: 1 }],
            },
          },
          tailPart,
        ],
      },
    ]);

    state = applyPartRemoval(state, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "tool-locations:tool-1",
      partIndex: 1,
      part: {
        type: "data-tool-locations",
        data: {
          toolCallId: "tool-1",
          locations: [{ path: "src/example.ts", line: 1 }],
        },
      },
    });

    expect(state.byId.get("m1")?.parts).toEqual([
      leadPart,
      tailPart,
    ]);

    state = applyPartUpdate(state, {
      messageId: "m1",
      messageRole: "assistant",
      partId: "part-tail",
      partIndex: 1,
      part: { type: "text", text: "tail updated", state: "done" },
      isNew: false,
    });

    expect(state.byId.get("m1")?.parts).toEqual([
      leadPart,
      {
        type: "text",
        text: "tail updated",
        state: "done",
        id: "part-tail",
      } as UIMessage["parts"][number],
    ]);
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

  test("finalizeStreamingMessagesInState skips messages with approval-requested (preserves live permission state)", () => {
    const initial = replaceMessagesState([
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking", state: "streaming" },
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
    // The entire message is preserved because it contains an approval-requested
    // tool part. This prevents premature finalization from destroying live
    // permission state before the user has responded.
    expect(finalized).toBe(initial);
    expect(finalized.byId.get("m2")?.parts[0]).toEqual({
      type: "reasoning",
      text: "thinking",
      state: "streaming",
    });
    expect(finalized.byId.get("m2")?.parts[1]).toEqual({
      type: "tool-bash",
      toolCallId: "tool-2",
      state: "approval-requested",
      input: { cmd: "rm -rf /tmp/demo" },
      approval: { id: "req-1" },
    });
  });

  test("finalizeStreamingMessagesInState finalizes other messages while preserving permission messages", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "answer", state: "streaming" }],
      },
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
    // m1 (no approval) is finalized
    expect(finalized.byId.get("m1")?.parts[0]).toEqual({
      type: "text",
      text: "answer",
      state: "done",
    });
    // m2 (has approval-requested) is preserved
    expect(finalized.byId.get("m2")?.parts[0]).toEqual({
      type: "tool-bash",
      toolCallId: "tool-2",
      state: "approval-requested",
      input: { cmd: "rm -rf /tmp/demo" },
      approval: { id: "req-1" },
    });
  });

  // =========================================================================
  // Regression: premature finalization + live approval-requested override
  // =========================================================================

  test("applyPartUpdate accepts approval-requested over prematurely finalized output-available (regression)", () => {
    // Simulate the exact bug scenario:
    // 1. Tool created at input-available
    // 2. Premature finalizeStreamingMessagesInState runs → output-available
    // 3. Live permission event arrives with approval-requested
    //
    // Before fix: shouldKeepExistingPart(output-available[5], approval-requested[3])
    // returned true → update silently dropped → dialog never opened.

    // Step 1: message with tool at input-available
    const initial = replaceMessagesState([
      {
        id: "msg-c1f55",
        role: "assistant",
        parts: [
          { type: "text", text: "running tool", state: "done" },
          {
            type: "tool-bash",
            toolCallId: "tool-abc",
            state: "input-available",
            input: { cmd: "cat secrets.txt" },
          },
        ],
      },
    ]);

    // Step 2: premature finalization (from stale statusRef = "ready")
    const finalized = finalizeStreamingMessagesInState(initial);
    expect(finalized.byId.get("msg-c1f55")?.parts[1]).toMatchObject({
      state: "output-available",
    });

    // Step 3: live permission event arrives with isNew=false
    const afterPermission = applyPartUpdate(finalized, {
      messageId: "msg-c1f55",
      messageRole: "assistant",
      partId: "tool:abc",
      partIndex: 1,
      part: {
        type: "tool-bash",
        toolCallId: "tool-abc",
        state: "approval-requested",
        input: { cmd: "cat secrets.txt" },
        approval: { id: "req-perm-1" },
      },
      isNew: false,
    });

    // The approval-requested MUST override output-available
    expect(afterPermission).not.toBe(finalized);
    const toolPart = afterPermission.byId.get("msg-c1f55")?.parts[1];
    expect(toolPart).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-abc",
      state: "approval-requested",
      input: { cmd: "cat secrets.txt" },
      approval: { id: "req-perm-1" },
    });
  });

  test("applyPartUpdate treats semantically equal tool payloads as unchanged even when object key order differs", () => {
    const initial = replaceMessagesState([
      {
        id: "m-equal-tool",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "output-available",
            input: {
              cmd: "ls",
              flags: {
                all: true,
                long: true,
              },
            },
            output: {
              exitCode: 0,
              meta: {
                alpha: 1,
                beta: 2,
              },
            },
          },
        ],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m-equal-tool",
      messageRole: "assistant",
      partId: "tool:1",
      partIndex: 0,
      isNew: false,
      part: {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: {
          flags: {
            long: true,
            all: true,
          },
          cmd: "ls",
        },
        output: {
          meta: {
            beta: 2,
            alpha: 1,
          },
          exitCode: 0,
        },
      },
    });

    expect(updated).toBe(initial);
  });

  test("applyPartUpdate accepts approval-requested over output-cancelled (regression)", () => {
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "output-cancelled",
            input: { cmd: "ls" },
          },
        ],
      },
    ]);

    const updated = applyPartUpdate(initial, {
      messageId: "m1",
      messageRole: "assistant",
      partIndex: 0,
      part: {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "approval-requested",
        input: { cmd: "ls" },
        approval: { id: "req-2" },
      },
      isNew: false,
    });

    expect(updated).not.toBe(initial);
    expect(updated.byId.get("m1")?.parts[0]).toMatchObject({
      state: "approval-requested",
      approval: { id: "req-2" },
    });
  });

  test("merge snapshot accepts approval-requested over prematurely finalized part (regression)", () => {
    // Existing state has prematurely finalized tool
    const initial = replaceMessagesState([
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "output-available",
            input: { cmd: "cat file" },
            output: null,
            preliminary: true,
          },
        ],
      },
    ]);

    // Incoming snapshot from DB/refresh has the correct approval state
    const updated = mergeMessagesIntoState(initial, [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "approval-requested",
            input: { cmd: "cat file" },
            approval: { id: "req-3" },
          },
        ],
      },
    ]);

    // approval-requested should override prematurely finalized output-available
    expect(updated.byId.get("m1")?.parts[0]).toMatchObject({
      state: "approval-requested",
      approval: { id: "req-3" },
    });
  });

  // =========================================================================
  // End-to-end live permission flow simulation
  // =========================================================================

  test("full live permission flow: create → finalize race → approval → findPendingPermission", () => {
    // 1. Tool created during streaming
    let state = replaceMessagesState([
      {
        id: "msg-perm",
        role: "assistant",
        parts: [
          { type: "text", text: "analyzing request", state: "done" },
          {
            type: "tool-bash",
            toolCallId: "tool-perm-1",
            state: "input-available",
            input: { cmd: "rm -rf /important" },
          },
        ],
      },
    ]);

    // 2. Premature finalization (stale statusRef = "ready")
    state = finalizeStreamingMessagesInState(state);
    expect(state.byId.get("msg-perm")?.parts[1]).toMatchObject({
      state: "output-available",
    });

    // 3. Permission tool part arrives (isNew: false from server)
    state = applyPartUpdate(state, {
      messageId: "msg-perm",
      messageRole: "assistant",
      partId: "tool:perm-1",
      partIndex: 1,
      part: {
        type: "tool-bash",
        toolCallId: "tool-perm-1",
        state: "approval-requested",
        input: { cmd: "rm -rf /important" },
        approval: { id: "req-live-1" },
      },
      isNew: false,
    });

    // 4. Permission options part arrives (isNew: true)
    state = applyPartUpdate(state, {
      messageId: "msg-perm",
      messageRole: "assistant",
      partId: "permission:live-1",
      partIndex: 2,
      part: {
        type: "data-permission-options",
        data: {
          requestId: "req-live-1",
          toolCallId: "tool-perm-1",
          options: [
            { id: "allow-once", label: "Allow once" },
            { id: "deny", label: "Deny" },
          ],
        },
      },
      isNew: true,
    });

    // 5. findPendingPermission MUST return the request
    const pending = findPendingPermission(state.byId.values());
    expect(pending).not.toBeNull();
    expect(pending?.requestId).toBe("req-live-1");
    expect(pending?.toolCallId).toBe("tool-perm-1");
    expect(pending?.options).toEqual([
      { id: "allow-once", label: "Allow once" },
      { id: "deny", label: "Deny" },
    ]);
  });
});
