import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../ui-message";
import {
  compareUiMessagesChronologically,
  findUiMessageInsertIndex,
} from "./message-order";

function createMessage(
  id: string,
  role: UIMessage["role"],
  createdAt?: number
): UIMessage {
  return {
    id,
    role,
    ...(typeof createdAt === "number" ? { createdAt } : {}),
    parts: [{ type: "text", text: id }],
  };
}

describe("compareUiMessagesChronologically", () => {
  test("orders by createdAt ascending", () => {
    const a = createMessage("m1", "user", 1000);
    const b = createMessage("m2", "assistant", 2000);
    expect(compareUiMessagesChronologically(a, b)).toBeLessThan(0);
  });

  test("uses role tie-break when createdAt is equal", () => {
    const user = createMessage("m-user", "user", 1000);
    const assistant = createMessage("m-assistant", "assistant", 1000);
    expect(compareUiMessagesChronologically(user, assistant)).toBeLessThan(0);
  });

  test("pushes messages without createdAt after timestamped messages", () => {
    const timestamped = createMessage("m-ts", "assistant", 1000);
    const legacy = createMessage("m-legacy", "assistant");
    expect(compareUiMessagesChronologically(timestamped, legacy)).toBeLessThan(
      0
    );
  });
});

describe("findUiMessageInsertIndex", () => {
  test("inserts late user before trailing assistant", () => {
    const ordered = [
      createMessage("m1", "user", 1000),
      createMessage("m2", "assistant", 1100),
      createMessage("m3", "assistant", 2000),
    ];
    const lateUser = createMessage("m4", "user", 1500);
    expect(findUiMessageInsertIndex(ordered, lateUser)).toBe(2);
  });

  test("appends legacy message when all peers are legacy", () => {
    const ordered = [
      createMessage("m1", "user"),
      createMessage("m2", "assistant"),
    ];
    const legacy = createMessage("m3", "user");
    expect(findUiMessageInsertIndex(ordered, legacy)).toBe(2);
  });
});
