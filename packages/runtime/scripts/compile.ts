import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { file, spawn, write } from "bun";

async function runCommand(command: string, args: string[]): Promise<void> {
  const subprocess = spawn([command, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${String(exitCode)}`
    );
  }
}

const cwd = process.cwd();
const distDir = resolve(cwd, "dist");
const debug = process.argv.includes("--debug");

await runCommand("bun", ["run", "build"]);
const compileArgs = [
  "build",
  "--compile",
  "--minify",
  "./src/index.ts",
  "./src/bootstrap/sqlite-worker.entry.ts",
  "./src/bootstrap/usage-stats-scan.worker.entry.ts",
  "--outfile",
  "dist/server",
];
if (debug) {
  compileArgs.splice(3, 0, "--sourcemap");
}
await runCommand("bun", compileArgs);
await mkdir(distDir, { recursive: true });
await write(
  resolve(distDir, "settings.json"),
  file(resolve(cwd, "settings.example.json"))
);
await cp(resolve(cwd, "drizzle"), resolve(distDir, "drizzle"), {
  recursive: true,
  force: true,
});
