import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  createWindowsTaskSettingsScript,
  parseRuntimeDaemonManifest,
  resolveDaemonBootSecurityEnvironment,
  shouldEnableUserRuntimeDaemon,
} from "./runtime-daemon-controller.js";

describe("shouldEnableUserRuntimeDaemon", () => {
  test("keeps development on the stable child runtime unless explicitly enabled", () => {
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "main-thread",
        isPackaged: false,
        platform: "win32",
      })
    ).toBe(false);
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "main-thread",
        configuredValue: "1",
        isPackaged: false,
        platform: "win32",
      })
    ).toBe(true);
  });

  test("keeps packaged daemon default while honoring disable and platform gates", () => {
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "main-thread",
        isPackaged: true,
        platform: "linux",
      })
    ).toBe(true);
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "main-thread",
        configuredValue: "0",
        isPackaged: true,
        platform: "linux",
      })
    ).toBe(false);
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "client-only",
        configuredValue: "1",
        isPackaged: true,
        platform: "win32",
      })
    ).toBe(false);
    expect(
      shouldEnableUserRuntimeDaemon({
        desktopMode: "main-thread",
        configuredValue: "1",
        isPackaged: true,
        platform: "darwin",
      })
    ).toBe(false);
  });
});

describe("createWindowsTaskSettingsScript", () => {
  test("keeps the user daemon available and restarts failures", () => {
    const script = createWindowsTaskSettingsScript();

    expect(script).toContain("-RestartCount 999");
    expect(script).toContain("-RestartInterval (New-TimeSpan -Minutes 1)");
    expect(script).toContain("-StartWhenAvailable");
    expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(script).toContain("-AllowStartIfOnBatteries");
    expect(script).toContain("-DontStopIfGoingOnBatteries");
    expect(script).toContain("-MultipleInstances IgnoreNew");
    expect(script).toContain("EragearRuntimeDaemon");
  });
});

describe("resolveDaemonBootSecurityEnvironment", () => {
  test("uses development defaults only outside production", () => {
    expect(resolveDaemonBootSecurityEnvironment("development", {})).toEqual({
      NODE_ENV: "development",
      ALLOW_INSECURE_DEV_DEFAULTS: "true",
    });
  });

  test("forces production secure mode and persists only explicit policy keys", () => {
    expect(
      resolveDaemonBootSecurityEnvironment("production", {
        ALLOW_INSECURE_DEV_DEFAULTS: "true",
        ALLOWED_AGENT_COMMAND_POLICIES: '[{"command":"codex"}]',
        SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS: '["bun test"]',
        TELEGRAM_BOT_TOKEN: "must-not-be-written-to-the-launcher",
      })
    ).toEqual({
      NODE_ENV: "production",
      ALLOW_INSECURE_DEV_DEFAULTS: "false",
      ALLOWED_AGENT_COMMAND_POLICIES: '[{"command":"codex"}]',
      SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS: '["bun test"]',
    });
  });
});

describe("parseRuntimeDaemonManifest", () => {
  test("accepts a loopback-only manifest without embedding the token", () => {
    const tokenPath = path.resolve("private", "token");
    const manifest = parseRuntimeDaemonManifest(
      JSON.stringify({
        schemaVersion: 1,
        host: "127.0.0.1",
        port: 43_119,
        runtimeUrl: "ws://127.0.0.1:43119",
        healthUrl: "http://127.0.0.1:43119/api/health",
        tokenPath,
        pid: 42,
        startedAt: "2026-08-10T00:00:00.000Z",
      })
    );

    expect(manifest.tokenPath).toBe(tokenPath);
    expect(JSON.stringify(manifest)).not.toContain("apiKey");
  });

  test("rejects non-loopback endpoints", () => {
    expect(() =>
      parseRuntimeDaemonManifest(
        JSON.stringify({
          schemaVersion: 1,
          host: "127.0.0.1",
          port: 43_119,
          runtimeUrl: "ws://0.0.0.0:43119",
          healthUrl: "http://127.0.0.1:43119/api/health",
          tokenPath: path.resolve("private", "token"),
          pid: 42,
          startedAt: "2026-08-10T00:00:00.000Z",
        })
      )
    ).toThrow("Invalid user runtime daemon manifest");
  });
});
