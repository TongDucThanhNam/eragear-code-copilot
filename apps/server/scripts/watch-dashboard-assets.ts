import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), "public/dashboard");
const cssSource = resolve(
  process.cwd(),
  "src/presentation/dashboard/styles.css"
);
const cssOut = resolve(outDir, "styles.css");
const jsEntry = resolve(
  process.cwd(),
  "src/presentation/dashboard/client/index.tsx"
);
const jsOut = resolve(outDir, "client.js");

const copyStyles = async () => {
  try {
    await copyFile(cssSource, cssOut);
  } catch (error) {
    console.error("[dashboard:watch] Failed to copy styles.css", error);
  }
};

await mkdir(outDir, { recursive: true });
await copyStyles();

const build = spawn(
  "bun",
  [
    "build",
    jsEntry,
    "--outfile",
    jsOut,
    "--target",
    "browser",
    "--format",
    "esm",
    "--watch",
    "--minify",
  ],
  { stdio: "inherit" }
);

const cssWatcher = watch(cssSource, { persistent: true }, () => {
  copyStyles();
});

const shutdown = (signal: NodeJS.Signals) => {
  cssWatcher.close();
  build.kill(signal);
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});

build.on("exit", (code) => {
  cssWatcher.close();
  process.exit(code ?? 0);
});
