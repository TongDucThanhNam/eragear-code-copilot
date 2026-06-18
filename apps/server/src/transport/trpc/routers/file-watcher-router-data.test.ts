import { describe, expect, test } from "bun:test";
import {
  createFileWatcherStatusInput,
  FileWatcherStatusRequestSchema,
} from "./file-watcher-router-data";

describe("FileWatcherStatusRequestSchema", () => {
  test("keeps the transport request strict", () => {
    expect(
      FileWatcherStatusRequestSchema.safeParse({
        currentUserOnly: true,
        userId: "user-2",
      }).success
    ).toBe(false);
  });
});

describe("createFileWatcherStatusInput", () => {
  test("scopes status reads to the current user by default", () => {
    expect(createFileWatcherStatusInput(undefined, "user-1")).toEqual({
      userId: "user-1",
    });
  });

  test("keeps explicit current-user status reads scoped", () => {
    expect(
      createFileWatcherStatusInput({ currentUserOnly: true }, "user-1")
    ).toEqual({ userId: "user-1" });
  });

  test("uses a global status read only when explicitly requested", () => {
    expect(
      createFileWatcherStatusInput({ currentUserOnly: false }, "user-1")
    ).toBeUndefined();
  });
});
