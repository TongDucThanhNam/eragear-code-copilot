import { spawn } from "node:child_process";
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
  },
  {
    source: resolve(
      process.cwd(),
      "src/presentation/dashboard/styles-enhanced.css"
    ),
    out: resolve(outDir, "styles-enhanced.css"),
  },
  {
    source: resolve(process.cwd(), "src/presentation/dashboard/login.css"),
    out: resolve(outDir, "login.css"),
  },
  {
    source: resolve(process.cwd(), "src/presentation/dashboard/login.js"),
    out: resolve(outDir, "login.js"),
  },
] as const;

async function runBunBuild(): Promise<void> {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const proc = spawn(
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
        "--minify",
      ],
      { stdio: "inherit" }
    );
    proc.on("error", rejectBuild);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      rejectBuild(
        new Error(`dashboard asset build failed with exit code ${String(code)}`)
      );
    });
  });
}

await mkdir(outDir, { recursive: true });
await runBunBuild();
await Promise.all(
  staticAssets.map(async (asset) => {
    await copyFile(asset.source, asset.out);
  })
);
