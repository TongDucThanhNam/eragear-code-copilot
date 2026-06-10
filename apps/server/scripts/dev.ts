import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";

interface ChildSpec {
  name: string;
  args: string[];
  env?: Record<string, string>;
}

const children: ChildProcess[] = [];
let shuttingDown = false;
const defaultDevServerEnv =
  process.env.ALLOW_INSECURE_DEV_DEFAULTS === undefined
    ? { ALLOW_INSECURE_DEV_DEFAULTS: "true" }
    : {};

// Load .env explicitly so child process inherits all env vars
config({ path: path.join(process.cwd(), ".env") });

const startChild = ({ name, args, env }: ChildSpec) => {
  const child = spawn("bun", args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const proc of children) {
      if (!proc.killed) {
        proc.kill("SIGTERM");
      }
    }
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[dev] ${name} failed to start`, error);
  });
};

const runRequiredCommand = ({ name, args, env }: ChildSpec) => {
  const result = spawnSync("bun", args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  if (result.error) {
    console.error(`[dev] ${name} failed to start`, result.error);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`[dev] ${name} exited via signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const proc of children) {
    if (!proc.killed) {
      proc.kill(signal);
    }
  }
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});

runRequiredCommand({
  name: "dashboard-assets-build",
  args: ["run", "ui:build"],
});
startChild({ name: "dashboard-assets", args: ["run", "ui:watch"] });
startChild({
  name: "server",
  args: ["run", "--hot", "src/index.ts"],
  env: { NODE_ENV: "development", ...defaultDevServerEnv },
});
