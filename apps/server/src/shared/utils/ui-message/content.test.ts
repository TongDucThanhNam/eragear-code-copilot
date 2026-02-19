import { describe, expect, test } from "bun:test";
import type { StoredContentBlock } from "@/shared/types/session.types";
import { contentBlockToParts } from "./content";

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
});
