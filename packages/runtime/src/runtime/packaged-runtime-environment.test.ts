import { describe, expect, test } from "bun:test";
import path from "node:path";
import { configurePackagedRuntimeEnvironment } from "./packaged-runtime-environment";

describe("configurePackagedRuntimeEnvironment", () => {
  test("creates strict production defaults and detected CLI policies", async () => {
    const env: NodeJS.ProcessEnv = {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    };
    const execPath = path.resolve("runtime", "eragear-runtime.exe");
    const codexPath = path.resolve("tools", "codex.cmd");

    await configurePackagedRuntimeEnvironment({
      env,
      execPath,
      platform: "win32",
      resolveCliAvailability: async () => [
        {
          id: "codex",
          displayName: "Codex",
          command: "codex",
          available: true,
          executablePath: codexPath,
          message: "available",
          installHint: "install",
        },
      ],
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.ALLOW_INSECURE_DEV_DEFAULTS).toBe("false");
    expect(env.CONFIG_STRICT_ALLOWLIST).toBe("true");
    expect(JSON.parse(env.ALLOWED_AGENT_COMMAND_POLICIES ?? "[]")).toEqual([
      { command: execPath, allowAnyArgs: false, allowedArgs: [] },
      { command: codexPath, allowAnyArgs: true },
    ]);
    expect(JSON.parse(env.ALLOWED_TERMINAL_COMMAND_POLICIES ?? "[]")).toEqual([
      {
        command: "C:\\Windows\\System32\\cmd.exe",
        allowAnyArgs: true,
      },
    ]);
    expect(env.ALLOWED_ENV_KEYS).toContain("USERPROFILE");
  });

  test("does not replace explicit security policies", async () => {
    const env: NodeJS.ProcessEnv = {
      ALLOWED_AGENT_COMMAND_POLICIES: '[{"command":"C:\\\\agent.exe"}]',
      ALLOWED_TERMINAL_COMMAND_POLICIES: '[{"command":"C:\\\\terminal.exe"}]',
      ALLOWED_ENV_KEYS: "PATH,CUSTOM_KEY",
    };

    await configurePackagedRuntimeEnvironment({
      env,
      platform: "win32",
      resolveCliAvailability: () =>
        Promise.reject(new Error("explicit policy should skip discovery")),
    });

    expect(env.ALLOWED_AGENT_COMMAND_POLICIES).toContain("agent.exe");
    expect(env.ALLOWED_TERMINAL_COMMAND_POLICIES).toContain("terminal.exe");
    expect(env.ALLOWED_ENV_KEYS).toBe("PATH,CUSTOM_KEY");
  });
});
