import { describe, expect, test } from "bun:test";
import {
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
