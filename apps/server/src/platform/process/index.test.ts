import { describe, expect, test } from "bun:test";
import { AgentRuntimeAdapter, shouldUseWindowsShellFallback } from "./index";

const AMBIGUOUS_ALIAS_REGEX = /alias is ambiguous/i;
const INVOCATION_NOT_ALLOWED_REGEX = /invocation not allowed/i;
const PATH_SPLIT_REGEX = /[\\/]/;
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
  test("enables shell fallback only for .cmd/.bat on win32", () => {
    expect(
      shouldUseWindowsShellFallback("C:\\Tools\\claude-code-acp.cmd", "win32")
    ).toBe(true);
    expect(
      shouldUseWindowsShellFallback("C:\\Tools\\claude-code-acp.BAT", "win32")
    ).toBe(true);
    expect(
      shouldUseWindowsShellFallback("C:\\Tools\\claude-code-acp.exe", "win32")
    ).toBe(false);
    expect(
      shouldUseWindowsShellFallback("/usr/local/bin/claude-code-acp", "linux")
    ).toBe(false);
  });

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

  test("resolves unique basename aliases to allowed absolute commands", () => {
    const adapter = createAdapter();
    const alias =
      process.execPath.split(PATH_SPLIT_REGEX).pop() ?? process.execPath;
    const proc = adapter.spawn(alias, ["--version"], {
      cwd: process.cwd(),
      env: {},
    });
    expect(typeof proc.pid).toBe("number");
  });

  test("rejects ambiguous basename aliases", () => {
    const adapter = new AgentRuntimeAdapter({
      allowedAgentCommandPolicies: [
        {
          command: "/tmp/bin/claude-code-acp",
          allowAnyArgs: true,
        },
        {
          command: "/opt/tools/claude-code-acp",
          allowAnyArgs: true,
        },
      ],
      allowedEnvKeys: ["PATH"],
      agentTimeoutMs: undefined,
    });

    expect(() =>
      adapter.spawn("claude-code-acp", ["--version"], {
        cwd: process.cwd(),
        env: {},
      })
    ).toThrow(AMBIGUOUS_ALIAS_REGEX);
  });

  test("rejects non-basename command alias invocations", () => {
    const adapter = createAdapter();
    const alias =
      process.execPath.split(PATH_SPLIT_REGEX).pop() ?? process.execPath;

    expect(() =>
      adapter.spawn(`./${alias}`, ["--version"], {
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

  test("applies updated invocation policy for subsequent spawns", () => {
    const adapter = createAdapter();
    adapter.updateInvocationPolicy?.({
      allowedAgentCommandPolicies: [
        {
          command: "/bin/echo",
          allowAnyArgs: true,
        },
      ],
      allowedEnvKeys: ["PATH"],
    });

    expect(() =>
      adapter.spawn(process.execPath, ["--version"], {
        cwd: process.cwd(),
        env: {},
      })
    ).toThrow(INVOCATION_NOT_ALLOWED_REGEX);
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

  test("keeps tracked process records bounded under spawn churn", async () => {
    const adapter = createAdapter();
    for (let index = 0; index < 300; index += 1) {
      adapter.spawn(process.execPath, ["-e", "process.exit(0)"], {
        cwd: process.cwd(),
        env: {},
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    const tracked = (adapter as unknown as { trackedProcesses: Set<unknown> })
      .trackedProcesses;
    expect(tracked.size).toBeLessThanOrEqual(128);
  });
});
