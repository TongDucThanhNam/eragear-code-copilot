import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemSupervisorProjectContextAdapter } from "./filesystem-supervisor-project-context.adapter";

describe("FileSystemSupervisorProjectContextAdapter", () => {
  test("builds a bounded project snapshot from common project files", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "supervisor-project-context-")
    );
    try {
      await mkdir(path.join(root, "src"));
      await mkdir(path.join(root, "node_modules"));
      await writeFile(
        path.join(root, "README.md"),
        "# Demo Project\n\nSmall static HTML project.",
        "utf8"
      );
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "demo",
          description: "Demo description",
          scripts: { dev: "vite", build: "vite build" },
          dependencies: { "@vitejs/plugin-react": "latest" },
          devDependencies: { typescript: "latest" },
        }),
        "utf8"
      );
      await writeFile(
        path.join(root, "index.html"),
        "<main>Hello demo</main>",
        "utf8"
      );
      await writeFile(path.join(root, ".env"), "SECRET=value", "utf8");
      await writeFile(
        path.join(root, "node_modules", "ignored.txt"),
        "ignored",
        "utf8"
      );

      const adapter = new FileSystemSupervisorProjectContextAdapter();
      const snapshot = await adapter.build({ projectRoot: root });

      expect(snapshot.topLevelEntries).toContain("README.md");
      expect(snapshot.topLevelEntries).toContain("package.json");
      expect(snapshot.topLevelEntries).toContain("index.html");
      expect(snapshot.topLevelEntries).not.toContain(".env");
      expect(snapshot.topLevelEntries).not.toContain("node_modules/");
      expect(snapshot.files.map((file) => file.path)).toEqual([
        "README.md",
        "package.json",
        "index.html",
      ]);
      expect(snapshot.files[0]?.excerpt).toContain("Small static HTML project");
      expect(snapshot.files[1]?.excerpt).toContain("name: demo");
      expect(snapshot.files[1]?.excerpt).toContain("scripts: dev, build");
      expect(snapshot.files[2]?.excerpt).toContain("Hello demo");
      expect(JSON.stringify(snapshot)).not.toContain("SECRET=value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
