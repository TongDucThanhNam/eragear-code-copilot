import { afterEach, describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import { pruneEditorTextBuffers } from "./editor-buffer.util";

const originalEditorBufferTtlMs = ENV.editorBufferTtlMs;
const originalEditorBufferMaxFilesPerSession =
  ENV.editorBufferMaxFilesPerSession;

afterEach(() => {
  ENV.editorBufferTtlMs = originalEditorBufferTtlMs;
  ENV.editorBufferMaxFilesPerSession = originalEditorBufferMaxFilesPerSession;
});

describe("pruneEditorTextBuffers", () => {
  test("evicts stale buffers by ttl", () => {
    ENV.editorBufferTtlMs = 1000;
    ENV.editorBufferMaxFilesPerSession = 10;

    const session = {
      editorTextBuffers: new Map([
        ["/tmp/old.ts", { content: "old", updatedAt: 1000 }],
        ["/tmp/fresh.ts", { content: "fresh", updatedAt: 4500 }],
      ]),
    };

    pruneEditorTextBuffers(session, 5000);

    expect(session.editorTextBuffers?.has("/tmp/old.ts")).toBe(false);
    expect(session.editorTextBuffers?.has("/tmp/fresh.ts")).toBe(true);
  });

  test("evicts oldest buffers when exceeding max files", () => {
    ENV.editorBufferTtlMs = 60_000;
    ENV.editorBufferMaxFilesPerSession = 2;

    const session = {
      editorTextBuffers: new Map([
        ["/tmp/1.ts", { content: "1", updatedAt: 1000 }],
        ["/tmp/2.ts", { content: "2", updatedAt: 2000 }],
        ["/tmp/3.ts", { content: "3", updatedAt: 3000 }],
      ]),
    };

    pruneEditorTextBuffers(session, 3000);

    expect(session.editorTextBuffers?.size).toBe(2);
    expect(session.editorTextBuffers?.has("/tmp/1.ts")).toBe(false);
    expect(session.editorTextBuffers?.has("/tmp/2.ts")).toBe(true);
    expect(session.editorTextBuffers?.has("/tmp/3.ts")).toBe(true);
  });
});
