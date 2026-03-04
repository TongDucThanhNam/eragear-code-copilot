import type { UIMessagePart } from "@repo/shared";
import { describe, expect, test } from "bun:test";
import {
  deduplicateKeys,
  getPartKey,
  parseToolOutput,
  resolveAssistantFinalVisibility,
} from "./agentic-message-utils";

describe("parseToolOutput", () => {
  test("extracts multiple terminal ids and strips handled terminal/diff payload", () => {
    const parsed = parseToolOutput([
      { type: "terminal", terminalId: "term-1" },
      { type: "terminal", terminalId: "term-2" },
      { type: "diff", path: "a.txt", newText: "next" },
    ]);

    expect(parsed.terminalIds).toEqual(["term-1", "term-2"]);
    expect(parsed.diffs).toEqual([{ path: "a.txt", newText: "next" }]);
    expect(parsed.result).toBeUndefined();
  });

  test("uses text content blocks as final tool result", () => {
    const parsed = parseToolOutput([
      {
        type: "content",
        content: { type: "text", text: "line-1" },
      },
      {
        type: "content",
        content: { type: "text", text: "line-2" },
      },
      { type: "terminal", terminalId: "term-1" },
    ]);

    expect(parsed.terminalIds).toEqual(["term-1"]);
    expect(parsed.result).toBe("line-1\nline-2");
  });
});

describe("resolveAssistantFinalVisibility", () => {
  test("keeps final text visible while streaming with tool chain", () => {
    const visibility = resolveAssistantFinalVisibility({
      finalText: "streaming answer",
      finalAttachmentsCount: 0,
      isStreaming: true,
      chainItemsCount: 2,
    });

    expect(visibility.showFinalText).toBe(true);
    expect(visibility.showFinalAttachments).toBe(false);
    expect(visibility.shouldRenderFinal).toBe(true);
  });

  test("hides attachments during streaming when chain is active", () => {
    const visibility = resolveAssistantFinalVisibility({
      finalText: null,
      finalAttachmentsCount: 2,
      isStreaming: true,
      chainItemsCount: 1,
    });

    expect(visibility.showFinalText).toBe(false);
    expect(visibility.showFinalAttachments).toBe(false);
    expect(visibility.shouldRenderFinal).toBe(false);
  });
});

describe("deduplicateKeys", () => {
  test("uses deterministic ordinal suffixes for repeated base keys", () => {
    const items: UIMessagePart[] = [
      { type: "text", text: "line-1", state: "streaming" },
      { type: "text", text: "line-2", state: "streaming" },
      { type: "reasoning", text: "plan", state: "streaming" },
      { type: "reasoning", text: "next", state: "streaming" },
    ];

    expect(deduplicateKeys(items)).toEqual([
      "text#0",
      "text#1",
      "reasoning#0",
      "reasoning#1",
    ]);
  });

  test("keeps keys stable for existing items when prepending a different part type", () => {
    const toolA: UIMessagePart = {
      type: "tool-bash",
      toolCallId: "tool-a",
      state: "output-available",
      input: { cmd: "echo a" },
      output: "ok",
    };
    const toolB: UIMessagePart = {
      type: "tool-bash",
      toolCallId: "tool-b",
      state: "output-available",
      input: { cmd: "echo b" },
      output: "ok",
    };
    const before: UIMessagePart[] = [
      { type: "text", text: "line-1", state: "streaming" },
      toolA,
      { type: "text", text: "line-2", state: "streaming" },
    ];
    const after: UIMessagePart[] = [toolB, ...before];

    const beforeKeys = deduplicateKeys(before, getPartKey);
    const afterKeys = deduplicateKeys(after, getPartKey);

    expect(beforeKeys[0]).toBe(afterKeys[1]);
    expect(beforeKeys[1]).toBe(afterKeys[2]);
    expect(beforeKeys[2]).toBe(afterKeys[3]);
  });

  test("prefers server-provided part id when available", () => {
    const items: UIMessagePart[] = [
      {
        type: "text",
        text: "line-1",
        state: "streaming",
        id: "part-server-1",
      } as UIMessagePart,
    ];

    expect(deduplicateKeys(items, getPartKey)).toEqual(["part:part-server-1#0"]);
  });
});
