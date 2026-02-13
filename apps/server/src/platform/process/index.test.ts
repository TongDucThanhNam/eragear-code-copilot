import { describe, expect, test } from "bun:test";
import { AgentRuntimeAdapter } from "./index";

const INVOCATION_NOT_ALLOWED_REGEX = /invocation not allowed/i;
const SHUTTING_DOWN_REGEX = /shutting down/i;

function createAdapter() {
  return new AgentRuntimeAdapter({
    allowedAgentCommandPolicies: [
      {
        command: process.execPath,
        allowAnyArgs: true,
      },
    ],
    allowedEnvKeys: ["PATH", "HOME"],
    agentTimeoutMs: undefined,
  });
}

describe("AgentRuntimeAdapter", () => {
  test("denies invocations that do not match allowed args", () => {
    const adapter = new AgentRuntimeAdapter({
      allowedAgentCommandPolicies: [
        {
          command: process.execPath,
          allowedArgs: ["--version"],
        },
      ],
      allowedEnvKeys: ["PATH"],
      agentTimeoutMs: undefined,
    });

    expect(() =>
      adapter.spawn(process.execPath, ["-e", "console.log('x')"], {
        cwd: process.cwd(),
        env: {},
      })
    ).toThrow(INVOCATION_NOT_ALLOWED_REGEX);
  });

  test("rejects spawn after shutdown begins", () => {
    const adapter = createAdapter();
    adapter.beginShutdown();

    expect(() =>
      adapter.spawn(process.execPath, ["--version"], {
        cwd: process.cwd(),
        env: {},
      })
    ).toThrow(SHUTTING_DOWN_REGEX);
  });

  test("terminates active processes and returns empty lingering list", async () => {
    const adapter = createAdapter();
    adapter.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      env: {},
    });

    const summary = await adapter.terminateAllActiveProcesses();
    expect(summary.terminated).toBeGreaterThanOrEqual(1);
    expect(summary.lingeringPids.length).toBe(0);
  });

  test("terminates lingering process groups even when tracked process already exited", async () => {
    const adapter = createAdapter();
    adapter.spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); setTimeout(() => process.exit(0), 10);`,
      ],
      {
        cwd: process.cwd(),
        env: {},
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    const summary = await adapter.terminateAllActiveProcesses();
    expect(summary.lingeringPids.length).toBe(0);
  });

  test("does not retain fast-exit processes in tracked state", async () => {
    const adapter = createAdapter();
    adapter.spawn(process.execPath, ["-e", "process.exit(0)"], {
      cwd: process.cwd(),
      env: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const tracked = (adapter as unknown as { trackedProcesses: Set<unknown> })
      .trackedProcesses;
    expect(tracked.size).toBe(0);
  });
});
