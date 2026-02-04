import { spawn } from "node:child_process";

type ChildSpec = {
  name: string;
  args: string[];
  env?: Record<string, string>;
};

const children: NodeJS.ChildProcess[] = [];
let shuttingDown = false;

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

startChild({ name: "dashboard-assets", args: ["run", "ui:watch"] });
startChild({
  name: "server",
  args: ["run", "--hot", "src/index.ts"],
  env: { NODE_ENV: "development" },
});
