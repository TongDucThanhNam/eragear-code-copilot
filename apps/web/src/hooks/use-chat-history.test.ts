import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import { replaceMessagesState } from "./use-chat-message-state";
import {
  applyLoadedHistoryToState,
  normalizeOlderHistoryBatchOrder,
  runSharedInFlightLoad,
} from "./use-chat-history";

function createMessage(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: id, state: "done" }],
  };
}

describe("runSharedInFlightLoad", () => {
  test("coalesces concurrent load calls into one in-flight promise", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;
    let releaseLoad: () => void = () => {};
    const blockedLoad = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });

    const first = runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
      await blockedLoad;
    });
    const second = runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });

    expect(runCount).toBe(1);
    expect(second).toBe(first);
    expect(inFlightRef.current).toBe(first);

    releaseLoad();
    await first;
    expect(inFlightRef.current).toBeNull();
  });

  test("starts a new load after the previous load settles", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;

    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });
    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });

    expect(runCount).toBe(2);
    expect(inFlightRef.current).toBeNull();
  });

  test("clears in-flight state when load rejects", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;

    await expect(
      runSharedInFlightLoad(inFlightRef, async () => {
        runCount += 1;
        throw new Error("history failure");
      })
    ).rejects.toThrow("history failure");

    expect(inFlightRef.current).toBeNull();

    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });
    expect(runCount).toBe(2);
  });
});

describe("normalizeOlderHistoryBatchOrder", () => {
  test("keeps chronological order when known overlap indexes are ascending", () => {
    const currentState = replaceMessagesState([
      createMessage("m1"),
      createMessage("m2"),
      createMessage("m3"),
    ]);
    const batch = [createMessage("m0"), createMessage("m1"), createMessage("m2")];

    const normalized = normalizeOlderHistoryBatchOrder(batch, currentState);
    expect(normalized.map((message) => message.id)).toEqual(["m0", "m1", "m2"]);
  });

  test("reverses batch when overlap indexes indicate newest-first ordering", () => {
    const currentState = replaceMessagesState([
      createMessage("m1"),
      createMessage("m2"),
      createMessage("m3"),
    ]);
    const batch = [createMessage("m2"), createMessage("m1"), createMessage("m0")];

    const normalized = normalizeOlderHistoryBatchOrder(batch, currentState);
    expect(normalized.map((message) => message.id)).toEqual(["m0", "m1", "m2"]);
  });
});

describe("applyLoadedHistoryToState", () => {
  test("keeps richer live permission parts when forced history snapshot is stale", () => {
    const currentState = replaceMessagesState([
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

    const nextState = applyLoadedHistoryToState(currentState, [
      {
        id: "m-permission",
        role: "assistant",
        parts: [{ type: "text", text: "checking", state: "done" }],
      },
    ]);

    expect(nextState.byId.get("m-permission")?.parts).toEqual([
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
});
