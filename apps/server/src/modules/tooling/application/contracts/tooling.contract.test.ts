import { describe, expect, test } from "bun:test";
import { SyncEditorBufferInputSchema } from "./tooling.contract";

describe("SyncEditorBufferInputSchema", () => {
  test("requires content when isDirty is true", () => {
    expect(() =>
      SyncEditorBufferInputSchema.parse({
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: true,
      })
    ).toThrow(/content is required/i);
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
