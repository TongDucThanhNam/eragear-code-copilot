import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type BuildConfig, build, file, write } from "bun";

const outDir = resolve(process.cwd(), "public/dashboard");
const jsEntry = resolve(
  process.cwd(),
  "src/presentation/dashboard/client/index.tsx"
);
const jsOut = resolve(outDir, "client.js");
const jsAssetOut = resolve(outDir, "client.asset");

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
    out: resolve(outDir, "login.asset"),
  },
] as const;

async function runBunBuild(): Promise<void> {
  const config = {
    entrypoints: [jsEntry],
    target: "browser",
    format: "esm",
    minify: true,
    write: false,
  } satisfies BuildConfig & { write: false };
  const result = await build(config);
  if (!result.success) {
    throw new AggregateError(result.logs, "Dashboard asset build failed");
  }
  const output =
    result.outputs.find((artifact) => artifact.type === "text/javascript") ??
    result.outputs[0];
  if (!output) {
    throw new Error("Dashboard asset build produced no output");
  }
  await Promise.all([write(jsOut, output), write(jsAssetOut, output)]);
}

await mkdir(outDir, { recursive: true });
await runBunBuild();
await Promise.all(
  staticAssets.map(async (asset) => {
    await write(asset.out, file(asset.source));
  })
);
