import { describe, expect, test } from "bun:test";
import { buildMentionItems } from "./shared";

describe("buildMentionItems", () => {
  test("dedupes paths while keeping active tabs first when query is empty", () => {
    const items = buildMentionItems({
      activeTabs: [{ path: "src/app.tsx" }, { path: "README.md" }],
      files: ["README.md", "src/app.tsx", "src/lib/utils.ts"],
      mentionQuery: "",
    });

    expect(items).toEqual([
      { path: "src/app.tsx", name: "app.tsx", dir: "src" },
      { path: "README.md", name: "README.md", dir: "" },
      { path: "src/lib/utils.ts", name: "utils.ts", dir: "src/lib" },
    ]);
  });

  test("filters case-insensitively when a mention query is present", () => {
    const items = buildMentionItems({
      activeTabs: [{ path: "src/app.tsx" }],
      files: ["src/App.tsx", "src/lib/utils.ts", "docs/APP-ARCH.md"],
      mentionQuery: "app",
    });

    expect(items).toEqual([
      { path: "src/App.tsx", name: "App.tsx", dir: "src" },
      { path: "docs/APP-ARCH.md", name: "APP-ARCH.md", dir: "docs" },
    ]);
  });
});
