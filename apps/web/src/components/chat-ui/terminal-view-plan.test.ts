import { describe, expect, test } from "bun:test";
import type { TerminalOutputSnapshot } from "@/store/chat-stream-store";
import { getTerminalWritePlan } from "./terminal-view-plan";

function createTerminalSnapshot(
  terminalId: string,
  text: string,
  overrides: Partial<TerminalOutputSnapshot> = {}
): TerminalOutputSnapshot {
  return {
    terminalId,
    chunks: text.length > 0 ? [text] : [],
    totalChars: text.length,
    startOffset: 0,
    touchedSeq: 1,
    ...overrides,
  };
}

describe("getTerminalWritePlan", () => {
  test("appends only the delta when the last terminal grows by suffix", () => {
    expect(
      getTerminalWritePlan(
        [createTerminalSnapshot("term-1", "abc", { touchedSeq: 1 })],
        [createTerminalSnapshot("term-1", "abcdef", { touchedSeq: 2 })]
      )
    ).toEqual({
      type: "append",
      chunks: ["def"],
    });
  });

  test("resets when a non-last terminal changes", () => {
    expect(
      getTerminalWritePlan(
        [
          createTerminalSnapshot("term-1", "abc", { touchedSeq: 1 }),
          createTerminalSnapshot("term-2", "tail", { touchedSeq: 1 }),
        ],
        [
          createTerminalSnapshot("term-1", "abc+", { touchedSeq: 2 }),
          createTerminalSnapshot("term-2", "tail", { touchedSeq: 1 }),
        ]
      )
    ).toEqual({
      type: "reset",
      chunks: ["abc+", "tail"],
    });
  });

  test("resets when the active terminal was trimmed", () => {
    expect(
      getTerminalWritePlan(
        [createTerminalSnapshot("term-1", "12345", { touchedSeq: 1 })],
        [
          createTerminalSnapshot("term-1", "67890", {
            touchedSeq: 2,
            startOffset: 5,
          }),
        ]
      )
    ).toEqual({
      type: "reset",
      chunks: ["67890"],
    });
  });

  test("replays full content when terminal list changes", () => {
    expect(
      getTerminalWritePlan(
        [createTerminalSnapshot("term-1", "same", { touchedSeq: 1 })],
        [createTerminalSnapshot("term-2", "next", { touchedSeq: 1 })]
      )
    ).toEqual({
      type: "reset",
      chunks: ["next"],
    });
  });

  test("is a no-op when terminal snapshots are unchanged", () => {
    const snapshot = createTerminalSnapshot("term-1", "same", {
      touchedSeq: 1,
    });
    expect(getTerminalWritePlan([snapshot], [snapshot])).toEqual({
      type: "noop",
    });
  });
});
