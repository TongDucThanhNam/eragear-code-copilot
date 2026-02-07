import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/platform/storage/sqlite-worker.entry.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@eragear-code-copilot\/.*/],
});
