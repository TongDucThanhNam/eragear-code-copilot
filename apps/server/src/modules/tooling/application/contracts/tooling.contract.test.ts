import { describe, expect, test } from "bun:test";
import { SyncEditorBufferInputSchema } from "./tooling.contract";

const CONTENT_IS_REQUIRED_REGEX = /content is required/i;

describe("SyncEditorBufferInputSchema", () => {
  test("requires content when isDirty is true", () => {
    expect(() =>
      SyncEditorBufferInputSchema.parse({
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: true,
      })
    ).toThrow(CONTENT_IS_REQUIRED_REGEX);
  });

  test("allows clear payload when isDirty is false", () => {
    expect(
      SyncEditorBufferInputSchema.parse({
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: false,
      })
    ).toEqual({
      chatId: "chat-1",
      path: "src/app.ts",
      isDirty: false,
    });
  });

  test("rejects unknown keys", () => {
    expect(() =>
      SyncEditorBufferInputSchema.parse({
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: false,
        unsafe: true,
      })
    ).toThrow();
  });
});
