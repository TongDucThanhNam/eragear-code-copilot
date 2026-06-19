import { describe, expect, test } from "bun:test";
import type { ToolUIPart, UIMessagePart } from "@eragear-code-copilot/shared";
import {
  deduplicateKeys,
  getPartKey,
  groupChainDisplayItems,
  isChainStreaming,
  isMessageStreaming,
  parseToolOutput,
  resolveAssistantFinalVisibility,
  splitMessageParts,
} from "./agentic-message-utils";

const toolPart = (
  type: string,
  toolCallId: string,
  input: Record<string, unknown> = { cmd: `echo ${toolCallId}` }
): ToolUIPart =>
  ({
    type: `tool-${type}`,
    toolCallId,
    state: "output-available",
    input,
    output: "ok",
  }) as ToolUIPart;

describe("parseToolOutput", () => {
  test("extracts multiple terminal ids and strips handled terminal/diff payload to file paths", () => {
    const parsed = parseToolOutput([
      { type: "terminal", terminalId: "term-1" },
      { type: "terminal", terminalId: "term-2" },
      { type: "diff", path: "a.txt", oldText: "old", newText: "next\nline" },
    ]);

    expect(parsed.terminalIds).toEqual(["term-1", "term-2"]);
    expect(parsed.changedFilePaths).toEqual(["a.txt"]);
    expect(parsed.changedFiles).toEqual([
      { path: "a.txt", addedLines: 2, removedLines: 1 },
    ]);
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
    expect(parsed.changedFilePaths).toEqual([]);
    expect(parsed.changedFiles).toEqual([]);
    expect(parsed.result).toBe("line-1\nline-2");
  });

  test("handles single diff output as a file path without preserving diff text", () => {
    const parsed = parseToolOutput({
      type: "diff",
      path: "src/app.tsx",
      oldText: "old",
      newText: "new",
    });

    expect(parsed.changedFilePaths).toEqual(["src/app.tsx"]);
    expect(parsed.changedFiles).toEqual([
      { path: "src/app.tsx", addedLines: 1, removedLines: 1 },
    ]);
    expect(parsed.result).toBeUndefined();
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

describe("assistant message streaming state", () => {
  test("keeps chain idle when only trailing final text is still streaming", () => {
    const parts: UIMessagePart[] = [
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { cmd: "pwd" },
        output: "/repo",
      },
      { type: "text", text: "final answer", state: "streaming" },
    ];

    const { chainItems, finalText } = splitMessageParts(parts);

    expect(chainItems).toHaveLength(1);
    expect(finalText).toBe("final answer");
    expect(isChainStreaming(parts)).toBe(false);
    expect(isMessageStreaming(parts)).toBe(true);
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

    expect(deduplicateKeys(items, getPartKey)).toEqual([
      "part:part-server-1#0",
    ]);
  });
});

describe("groupChainDisplayItems", () => {
  test("groups consecutive mixed tools into one display item", () => {
    const items: UIMessagePart[] = [
      toolPart("bash", "tool-a"),
      toolPart("read_file", "tool-b", { path: "README.md" }),
      toolPart("write_file", "tool-c", { path: "src/app.tsx" }),
    ];

    const grouped = groupChainDisplayItems(items);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.kind).toBe("tool-group");
    if (grouped[0]?.kind === "tool-group") {
      expect(grouped[0].tools.map((tool) => tool.toolCallId)).toEqual([
        "tool-a",
        "tool-b",
        "tool-c",
      ]);
      expect(grouped[0].originalStartIndex).toBe(0);
      expect(grouped[0].originalEndIndex).toBe(2);
    }
  });

  test("wraps a single tool call in a group layer", () => {
    const grouped = groupChainDisplayItems([toolPart("bash", "tool-a")]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.kind).toBe("tool-group");
    if (grouped[0]?.kind === "tool-group") {
      expect(grouped[0].tools.map((tool) => tool.toolCallId)).toEqual([
        "tool-a",
      ]);
      expect(grouped[0].originalStartIndex).toBe(0);
      expect(grouped[0].originalEndIndex).toBe(0);
    }
  });

  test("keeps text and reasoning boundaries between tool groups", () => {
    const items: UIMessagePart[] = [
      toolPart("bash", "tool-a"),
      { type: "text", text: "next", state: "done" },
      toolPart("bash", "tool-b"),
      toolPart("bash", "tool-c"),
    ];

    const grouped = groupChainDisplayItems(items);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]?.kind).toBe("tool-group");
    expect(grouped[1]?.kind).toBe("part");
    expect(grouped[2]?.kind).toBe("tool-group");
    if (grouped[0]?.kind === "tool-group") {
      expect(grouped[0].tools.map((tool) => tool.toolCallId)).toEqual([
        "tool-a",
      ]);
    }
    if (grouped[2]?.kind === "tool-group") {
      expect(grouped[2].tools.map((tool) => tool.toolCallId)).toEqual([
        "tool-b",
        "tool-c",
      ]);
    }
  });
});
