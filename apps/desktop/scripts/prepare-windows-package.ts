import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { file, spawn, write } from "bun";

interface DesktopPackageMetadata {
  description?: string;
  name: string;
  version: string;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  const subprocess = spawn([command, ...args], {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${String(exitCode)}`
    );
  }
}

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const runtimeRoot = path.join(repoRoot, "packages", "runtime");
const buildRoot = path.join(desktopRoot, "build");
const stagedAppRoot = path.join(buildRoot, "package");
const stagedRuntimeRoot = path.join(buildRoot, "runtime");
const desktopDist = path.join(desktopRoot, "dist");
const desktopIcon = path.join(desktopRoot, "public", "logo.png");
const runtimeExecutable = path.join(stagedRuntimeRoot, "eragear-runtime.exe");
const runtimeWorkerEntrypoint = path.join(
  stagedRuntimeRoot,
  "sqlite-worker.entry.js"
);
const desktopPackage = JSON.parse(
  await file(path.join(desktopRoot, "package.json")).text()
) as DesktopPackageMetadata;

await rm(stagedAppRoot, { recursive: true, force: true });
await rm(stagedRuntimeRoot, { recursive: true, force: true });
await mkdir(stagedAppRoot, { recursive: true });
await mkdir(stagedRuntimeRoot, { recursive: true });
await cp(desktopDist, path.join(stagedAppRoot, "dist"), {
  recursive: true,
  force: true,
});
await cp(desktopIcon, path.join(stagedAppRoot, "icon.png"), { force: true });

await write(
  path.join(stagedAppRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "eragear-code-copilot",
      productName: "Eragear Code Copilot",
      version: desktopPackage.version,
      description:
        desktopPackage.description ??
        "Desktop-first AI coding assistant powered by Electron and ACP.",
      main: "dist/main.cjs",
      packageManager: "npm@10.9.2",
      private: true,
      workspaces: [],
    },
    null,
    2
  )}\n`
);

await runCommand(
  process.execPath,
  [
    "build",
    "--compile",
    "--minify",
    "./src/runtime/desktop-sidecar.ts",
    "--outfile",
    runtimeExecutable,
  ],
  runtimeRoot
);
await runCommand(
  process.execPath,
  [
    "build",
    "--target=bun",
    "--minify",
    "./src/bootstrap/sqlite-worker.entry.ts",
    "--outdir",
    stagedRuntimeRoot,
    "--entry-naming=sqlite-worker.entry.js",
  ],
  runtimeRoot
);

console.log(`[desktop-package] Staged Electron app at ${stagedAppRoot}`);
console.log(`[desktop-package] Built runtime sidecar at ${runtimeExecutable}`);
console.log(
  `[desktop-package] Built SQLite worker at ${runtimeWorkerEntrypoint}`
);
