import { describe, expect, test } from "bun:test";
import type { UIMessage } from "@repo/shared";
import type { StoredContentBlock } from "@/shared/types/session.types";
import {
  appendReasoningPart,
  appendTextPart,
  contentBlockToParts,
} from "./content";

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
});
