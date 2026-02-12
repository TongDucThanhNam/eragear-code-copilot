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
});
