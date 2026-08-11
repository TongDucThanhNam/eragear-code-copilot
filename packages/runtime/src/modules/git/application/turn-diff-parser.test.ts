import { describe, expect, test } from "bun:test";
import { buildTurnCheckpointRef, parseTurnDiffFiles } from "./turn-diff-parser";

describe("parseTurnDiffFiles", () => {
  test("parses add, modify, delete, and rename summaries", () => {
    const diff = [
      "diff --git a/added.txt b/added.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/added.txt",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
      "diff --git a/modified.txt b/modified.txt",
      "--- a/modified.txt",
      "+++ b/modified.txt",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " stable",
      "diff --git a/deleted.txt b/deleted.txt",
      "deleted file mode 100644",
      "--- a/deleted.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-gone",
      "-away",
      "diff --git a/old-name.txt b/new-name.txt",
      "similarity index 100%",
      "rename from old-name.txt",
      "rename to new-name.txt",
    ].join("\n");

    expect(parseTurnDiffFiles(diff)).toEqual([
      {
        path: "added.txt",
        kind: "added",
        additions: 2,
        deletions: 0,
      },
      {
        path: "deleted.txt",
        kind: "deleted",
        additions: 0,
        deletions: 2,
      },
      {
        path: "modified.txt",
        kind: "modified",
        additions: 1,
        deletions: 1,
      },
      {
        path: "new-name.txt",
        oldPath: "old-name.txt",
        kind: "renamed",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  test("returns an empty summary for an empty patch", () => {
    expect(parseTurnDiffFiles("\r\n")).toEqual([]);
  });
});

describe("buildTurnCheckpointRef", () => {
  test("builds the Eragear hidden ref scheme", () => {
    expect(buildTurnCheckpointRef("chat-1", 3)).toBe(
      "refs/eragear/session-chat-1-turn-3"
    );
  });

  test("rejects unsafe session ids and invalid counts", () => {
    expect(() => buildTurnCheckpointRef("../chat", 1)).toThrow("unsafe");
    expect(() => buildTurnCheckpointRef("chat-1", -1)).toThrow("non-negative");
  });
});
