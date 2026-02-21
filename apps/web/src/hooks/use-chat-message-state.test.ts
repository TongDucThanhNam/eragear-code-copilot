import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import {
  createEmptyMessageState,
  mergeMessagesIntoState,
  prependMessagesIntoState,
  replaceMessagesState,
} from "./use-chat-message-state";

function createMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
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
    const updated = mergeMessagesIntoState(initial, [createMessage("m2", "two")]);

    expect(updated.order).toEqual(["m1", "m2"]);
    expect(updated.orderedMessages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(updated.indexById.get("m2")).toBe(1);
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
});
