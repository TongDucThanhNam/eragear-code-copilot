import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function importEnvironmentInSubprocess(overrides: Record<string, string>) {
  return spawnSync("bun", ["-e", "import './src/config/environment.ts';"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ALLOWED_AGENT_COMMANDS: "bun",
      ALLOWED_TERMINAL_COMMANDS: "bun",
      ALLOWED_ENV_KEYS: "PATH",
      ...overrides,
    },
    encoding: "utf8",
  });
}

describe("environment worker invariants", () => {
  test("fails fast when production disables SQLITE_WORKER_ENABLED", () => {
    const result = importEnvironmentInSubprocess({
      NODE_ENV: "production",
      SQLITE_WORKER_ENABLED: "false",
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr;
    expect(stderr).toContain("SQLITE_WORKER_ENABLED must be true");
  });

  test("allows SQLITE_WORKER_ENABLED=false outside production", () => {
    const result = importEnvironmentInSubprocess({
      NODE_ENV: "development",
      SQLITE_WORKER_ENABLED: "false",
    });

    expect(result.status).toBe(0);
  });
});
