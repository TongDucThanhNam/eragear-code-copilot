import { spawn } from "node:child_process";
import { copyFile, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });
    proc.on("error", rejectCommand);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${String(code)}`
        )
      );
    });
  });
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
  "--outfile",
  "dist/server",
];
if (debug) {
  compileArgs.splice(3, 0, "--sourcemap");
}
await runCommand("bun", compileArgs);
await mkdir(distDir, { recursive: true });
await copyFile(
  resolve(cwd, "settings.example.json"),
  resolve(distDir, "settings.json")
);
await cp(resolve(cwd, "drizzle"), resolve(distDir, "drizzle"), {
  recursive: true,
  force: true,
});
