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

await runCommand("bun", ["run", "build"]);
await runCommand("bun", [
  "build",
  "--compile",
  "--minify",
  "--sourcemap",
  "./src/index.ts",
  "--outfile",
  "dist/server",
]);
await mkdir(distDir, { recursive: true });
await copyFile(
  resolve(cwd, "settings.example.json"),
  resolve(distDir, "settings.json")
);
await cp(resolve(cwd, "drizzle"), resolve(distDir, "drizzle"), {
  recursive: true,
  force: true,
});
