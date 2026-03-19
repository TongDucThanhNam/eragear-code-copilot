import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import type { StoredContentBlock } from "@/shared/types/session.types";
import {
  appendReasoningPart,
  appendTextPart,
  contentBlockToParts,
} from "./content";

const MAX_INLINE_BINARY_BASE64_CHARS = 64 * 1024;

function getSourceDocumentFilename(uri: string): string | undefined {
  const block = {
    type: "resource",
    resource: {
      uri,
      mimeType: "text/plain",
      text: "payload",
    },
  } as StoredContentBlock;
  const parts = contentBlockToParts(block);
  const sourceDocumentPart = parts.find(
    (part) => part.type === "source-document"
  );
  if (!sourceDocumentPart || sourceDocumentPart.type !== "source-document") {
    return undefined;
  }
  return sourceDocumentPart.filename;
}

function getFilePartFilename(uri: string): string | undefined {
  const block = {
    type: "image",
    uri,
    mimeType: "image/png",
  } as StoredContentBlock;
  const parts = contentBlockToParts(block);
  const filePart = parts.find((part) => part.type === "file");
  if (!filePart || filePart.type !== "file") {
    return undefined;
  }
  return filePart.filename;
}

function createAssistantMessage(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [],
  };
}

describe("contentBlockToParts filename normalization", () => {
  test("extracts source-document filenames across URL and filesystem inputs", () => {
    const cases = [
      {
        input: "file:///C:/Users/Admin/file.txt",
        expected: "file.txt",
      },
      {
        input: "C:\\Users\\Admin\\file.txt",
        expected: "file.txt",
      },
      {
        input: "\\\\server\\share\\file.txt",
        expected: "file.txt",
      },
      {
        input: "/tmp/a/b.txt",
        expected: "b.txt",
      },
      {
        input: "https://host/path/to/data.json?x=1",
        expected: "data.json",
      },
    ];

    for (const testCase of cases) {
      expect(getSourceDocumentFilename(testCase.input)).toBe(testCase.expected);
    }
  });

  test("extracts file part filename from windows path", () => {
    expect(getFilePartFilename("C:\\Users\\Admin\\screenshot.png")).toBe(
      "screenshot.png"
    );
  });

  test("keeps backslashes for non-windows linux-like filenames", () => {
    expect(getSourceDocumentFilename("/tmp/notes\\v1.md")).toBe("notes\\v1.md");
  });
});

describe("append text sanitization", () => {
  test("escapes HTML tags in text parts", () => {
    const message = appendTextPart(
      createAssistantMessage("msg-text"),
      "<script>alert(1)</script>",
      "streaming"
    );

    const textPart = message.parts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  test("escapes HTML tags in reasoning parts", () => {
    const message = appendReasoningPart(
      createAssistantMessage("msg-reasoning"),
      "<b>reasoning</b>",
      "streaming"
    );

    const reasoningPart = message.parts[0];
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.text).toBe("&lt;b&gt;reasoning&lt;/b&gt;");
    }
  });

  test("merges cumulative streaming text snapshots without duplication", () => {
    let message = appendTextPart(
      createAssistantMessage("msg-cumulative"),
      "Hello",
      "streaming"
    );
    message = appendTextPart(message, "Hello world", "streaming");

    expect(message.parts).toHaveLength(1);
    const textPart = message.parts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Hello world");
      expect(textPart.state).toBe("streaming");
    }
  });

  test("dedupes long retransmitted streaming tail", () => {
    const longTail = " repeated-tail segment ".repeat(3);
    let message = appendTextPart(
      createAssistantMessage("msg-tail-retry"),
      `prefix${longTail}`,
      "streaming"
    );
    message = appendTextPart(message, longTail, "streaming");

    expect(message.parts).toHaveLength(1);
    const textPart = message.parts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe(`prefix${longTail}`);
      expect(textPart.state).toBe("streaming");
    }
  });

  test("merges late streaming tail into finalized text part", () => {
    let message = appendTextPart(
      createAssistantMessage("msg-late-tail"),
      "Game nam o",
      "done"
    );
    message = appendTextPart(message, " `demos/whack-mole-game/`", "streaming");

    expect(message.parts).toHaveLength(1);
    const textPart = message.parts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Game nam o `demos/whack-mole-game/`");
      expect(textPart.state).toBe("streaming");
    }
  });
});

describe("contentBlockToParts inline binary guard", () => {
  test("omits oversized image base64 payload without uri", () => {
    const block = {
      type: "image",
      mimeType: "image/png",
      data: "A".repeat(MAX_INLINE_BINARY_BASE64_CHARS + 1),
    } as StoredContentBlock;
    expect(contentBlockToParts(block)).toEqual([]);
  });

  test("keeps uri-backed image part even when base64 payload is oversized", () => {
    const block = {
      type: "image",
      uri: "file:///tmp/screenshot.png",
      mimeType: "image/png",
      data: "A".repeat(MAX_INLINE_BINARY_BASE64_CHARS + 1),
    } as StoredContentBlock;
    const parts = contentBlockToParts(block);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "file",
      url: "file:///tmp/screenshot.png",
    });
  });

  test("omits oversized resource blob from data-resource payload", () => {
    const block = {
      type: "resource",
      resource: {
        uri: "file:///tmp/archive.zip",
        mimeType: "application/zip",
        blob: "B".repeat(MAX_INLINE_BINARY_BASE64_CHARS + 8),
      },
    } as StoredContentBlock;
    const parts = contentBlockToParts(block);
    expect(parts[0]).toMatchObject({
      type: "source-document",
      sourceId: "file:///tmp/archive.zip",
    });
    expect(parts[1]).toMatchObject({
      type: "data-resource",
      data: expect.objectContaining({
        blobOmitted: true,
      }),
    });
    const resourceData = parts[1];
    if (resourceData?.type === "data-resource") {
      expect((resourceData.data as { blob?: unknown }).blob).toBeUndefined();
    }
  });
});
