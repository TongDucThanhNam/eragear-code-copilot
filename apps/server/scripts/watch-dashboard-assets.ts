import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), "public/dashboard");
const jsEntry = resolve(
  process.cwd(),
  "src/presentation/dashboard/client/index.tsx"
);
const jsOut = resolve(outDir, "client.js");

const staticAssets = [
  {
    source: resolve(process.cwd(), "src/presentation/dashboard/styles.css"),
    out: resolve(outDir, "styles.css"),
    label: "styles.css",
  },
  {
    source: resolve(
      process.cwd(),
      "src/presentation/dashboard/styles-enhanced.css"
    ),
    out: resolve(outDir, "styles-enhanced.css"),
    label: "styles-enhanced.css",
  },
  {
    source: resolve(process.cwd(), "src/presentation/dashboard/login.css"),
    out: resolve(outDir, "login.css"),
    label: "login.css",
  },
  {
    source: resolve(process.cwd(), "src/presentation/dashboard/login.js"),
    out: resolve(outDir, "login.js"),
    label: "login.js",
  },
] as const;

const copyStaticAsset = async (asset: (typeof staticAssets)[number]) => {
  try {
    await copyFile(asset.source, asset.out);
  } catch (error) {
    console.error(`[dashboard:watch] Failed to copy ${asset.label}`, error);
  }
};

await mkdir(outDir, { recursive: true });
await Promise.all(staticAssets.map((asset) => copyStaticAsset(asset)));

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

const staticWatchers = staticAssets.map((asset) =>
  watch(asset.source, { persistent: true }, () => {
    copyStaticAsset(asset);
  })
);

const shutdown = (signal: NodeJS.Signals) => {
  for (const watcher of staticWatchers) {
    watcher.close();
  }
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
  for (const watcher of staticWatchers) {
    watcher.close();
  }
  process.exit(code ?? 0);
});
