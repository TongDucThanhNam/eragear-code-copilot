import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const distDir = path.join(desktopRoot, "dist");

const entries = [
  {
    entrypoint: path.join(desktopRoot, "src", "main.ts"),
    outfile: path.join(distDir, "main.cjs"),
  },
  {
    entrypoint: path.join(desktopRoot, "src", "preload.ts"),
    outfile: path.join(distDir, "preload.cjs"),
  },
] as const;

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of entries) {
  const buildConfig = {
    entrypoints: [entry.entrypoint],
    target: "node",
    format: "cjs",
    external: ["electron"],
    write: false,
  } as unknown as Parameters<typeof Bun.build>[0];

  const result = await Bun.build(buildConfig);

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const output =
    result.outputs.find((artifact) => artifact.type === "text/javascript") ??
    result.outputs[0];

  if (!output) {
    console.error(`No build output produced for ${entry.entrypoint}`);
    process.exit(1);
  }

  await Bun.write(entry.outfile, output);
}
