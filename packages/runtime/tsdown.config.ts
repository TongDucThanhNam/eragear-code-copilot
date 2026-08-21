import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/bootstrap/sqlite-worker.entry.ts",
    "./src/bootstrap/usage-stats-scan.worker.entry.ts",
  ],
  format: "esm",
  loader: {
    ".asset": "asset",
    ".json": "asset",
    ".sql": "asset",
  },
  outDir: "./dist",
  clean: true,
  external: [/^bun(?::.*)?$/],
  noExternal: [/@eragear-code-copilot\/.*/],
});
