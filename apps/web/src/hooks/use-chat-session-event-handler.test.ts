import { describe, expect, test } from "bun:test";
import type { ChatStatus, UIMessage } from "@repo/shared";
import { replaceMessagesState } from "./use-chat-message-state";
import { reconcileMessageUpsertAfterStatus } from "./use-chat-session-event-handler";

function reconcileMessage(
  current: UIMessage[],
  incoming: UIMessage,
  status: ChatStatus
) {
  const state = replaceMessagesState(current);
  return reconcileMessageUpsertAfterStatus(state, incoming, status);
}

describe("reconcileMessageUpsertAfterStatus", () => {
  test("finalizes late assistant text snapshots after chat is ready", () => {
    const next = reconcileMessage(
      [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "draft", state: "done" }],
        },
      ],
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "draft v2", state: "streaming" }],
      },
      "ready"
    );

    expect(next.byId.get("m1")?.parts).toEqual([
      { type: "text", text: "draft v2", state: "done" },
    ]);
  });

  test("finalizes late tool snapshots after chat is inactive", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m2",
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
      "inactive"
    );

    expect(next.byId.get("m2")?.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { cmd: "ls" },
        output: null,
        preliminary: true,
      },
    ]);
  });

  test("cancels stale approval-requested tool snapshots after chat is ready", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m-permission",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-2",
            state: "approval-requested",
            input: { cmd: "cat secrets.txt" },
            approval: { id: "req-2" },
          },
        ],
      },
      "ready"
    );

    expect(next.byId.get("m-permission")?.parts).toEqual([
      {
        type: "tool-bash",
        toolCallId: "tool-2",
        state: "output-cancelled",
        input: { cmd: "cat secrets.txt" },
        approval: {
          id: "req-2",
          approved: false,
          reason: "cancelled",
        },
      },
    ]);
  });

  test("keeps streaming state untouched while chat is still streaming", () => {
    const next = reconcileMessage(
      [],
      {
        id: "m3",
        role: "assistant",
        parts: [{ type: "text", text: "still going", state: "streaming" }],
      },
      "streaming"
    );

    expect(next.byId.get("m3")?.parts).toEqual([
      { type: "text", text: "still going", state: "streaming" },
    ]);
  });
});
