import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function createIsolatedBootConfigPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "eragear-env-test-"));
  const filePath = path.join(dir, "settings.json");
  writeFileSync(filePath, JSON.stringify({}), "utf8");
  return filePath;
}

const defaultBootConfigPath = createIsolatedBootConfigPath();

function runEnvironmentSubprocess(params: {
  code: string;
  overrides?: Record<string, string>;
  includeRequiredAllowlists?: boolean;
}) {
  const { code, overrides, includeRequiredAllowlists = true } = params;
  const defaultCommandPolicy = JSON.stringify([
    { command: process.execPath, allowAnyArgs: true },
  ]);
  const requiredAllowlists = includeRequiredAllowlists
    ? {
        ALLOWED_AGENT_COMMAND_POLICIES: defaultCommandPolicy,
        ALLOWED_TERMINAL_COMMAND_POLICIES: defaultCommandPolicy,
        ALLOWED_AGENT_COMMANDS: process.execPath,
        ALLOWED_TERMINAL_COMMANDS: process.execPath,
        ALLOWED_ENV_KEYS: "PATH",
      }
    : {};
  return spawnSync("bun", ["-e", code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ERAGEAR_BOOT_CONFIG_PATH: defaultBootConfigPath,
      ...requiredAllowlists,
      ...(overrides ?? {}),
    },
    encoding: "utf8",
  });
}

function importEnvironmentInSubprocess(overrides: Record<string, string>) {
  return runEnvironmentSubprocess({
    code: "import './src/config/environment.ts';",
    overrides,
  });
}

function readEnvironmentValueInSubprocess(
  overrides: Record<string, string>,
  field: string,
  options?: { includeRequiredAllowlists?: boolean }
) {
  return runEnvironmentSubprocess({
    code: `import { ENV } from './src/config/environment.ts'; console.log(String(ENV.${field}));`,
    overrides,
    includeRequiredAllowlists: options?.includeRequiredAllowlists ?? true,
  });
}

async function writeBootConfigFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "eragear-boot-config-"));
  const filePath = path.join(dir, "settings.json");
  await writeFile(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

describe("environment worker invariants", () => {
  test("fails fast when production disables STORAGE_WORKER_ENABLED", () => {
    const result = importEnvironmentInSubprocess({
      NODE_ENV: "production",
      STORAGE_WORKER_ENABLED: "false",
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr;
    expect(stderr).toContain("STORAGE_WORKER_ENABLED must be true");
  });

  test("allows STORAGE_WORKER_ENABLED=false outside production", () => {
    const result = importEnvironmentInSubprocess({
      NODE_ENV: "development",
      STORAGE_WORKER_ENABLED: "false",
    });

    expect(result.status).toBe(0);
  });

  test("supports PORT/HOST aliases when WS_* are absent", () => {
    const portResult = readEnvironmentValueInSubprocess(
      {
        PORT: "4321",
        HOST: "127.0.0.1",
        WS_PORT: "",
        WS_HOST: "",
      },
      "wsPort"
    );
    expect(portResult.status).toBe(0);
    expect(portResult.stdout.trim()).toBe("4321");

    const hostResult = readEnvironmentValueInSubprocess(
      {
        PORT: "4321",
        HOST: "127.0.0.1",
        WS_PORT: "",
        WS_HOST: "",
      },
      "wsHost"
    );
    expect(hostResult.status).toBe(0);
    expect(hostResult.stdout.trim()).toBe("127.0.0.1");
  });

  test("falls back to default wsPort when WS_PORT is invalid", () => {
    const negativePort = readEnvironmentValueInSubprocess(
      {
        WS_PORT: "-1",
      },
      "wsPort"
    );
    expect(negativePort.status).toBe(0);
    expect(negativePort.stdout.trim()).toBe("3000");

    const overRangePort = readEnvironmentValueInSubprocess(
      {
        WS_PORT: "70000",
      },
      "wsPort"
    );
    expect(overRangePort.status).toBe(0);
    expect(overRangePort.stdout.trim()).toBe("3000");
  });

  test("falls back to default ACP stderr cap when env value is invalid", () => {
    const result = readEnvironmentValueInSubprocess(
      {
        ACP_STDERR_MAX_TOTAL_BYTES: "-1",
      },
      "acpStderrMaxTotalBytes"
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(String(16 * 1024 * 1024));
  });

  test("parses AUTH_REQUIRE_CLOUDFLARE_ACCESS from environment", () => {
    const result = readEnvironmentValueInSubprocess(
      {
        AUTH_REQUIRE_CLOUDFLARE_ACCESS: "true",
        AUTH_CLOUDFLARE_ACCESS_CLIENT_ID: "client-id",
        AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET: "client-secret",
      },
      "authRequireCloudflareAccess"
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("true");
  });

  test("fails fast when Cloudflare Access is required without verification config", () => {
    const result = importEnvironmentInSubprocess({
      AUTH_REQUIRE_CLOUDFLARE_ACCESS: "true",
      AUTH_CLOUDFLARE_ACCESS_CLIENT_ID: "",
      AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET: "",
      AUTH_CLOUDFLARE_ACCESS_JWT_PUBLIC_KEY_PEM: "",
      AUTH_CLOUDFLARE_ACCESS_JWT_AUDIENCE: "",
      AUTH_CLOUDFLARE_ACCESS_JWT_ISSUER: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "requires either service-token credentials or JWT verification configuration"
    );
  });

  test("fails fast when Cloudflare Access service token config is partial", () => {
    const result = importEnvironmentInSubprocess({
      AUTH_CLOUDFLARE_ACCESS_CLIENT_ID: "client-id",
      AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must both be set together");
  });

  test("fails fast when production sets CORS_STRICT_ORIGIN=false", () => {
    const result = importEnvironmentInSubprocess({
      NODE_ENV: "production",
      CORS_STRICT_ORIGIN: "false",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "CORS_STRICT_ORIGIN must be true in production runtime"
    );
  });

  test("fails fast when CORS_STRICT_ORIGIN uses invalid literal", () => {
    const result = importEnvironmentInSubprocess({
      CORS_STRICT_ORIGIN: "tru",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "CORS_STRICT_ORIGIN must be a strict boolean"
    );
  });

  test("falls back to defaults when positive-only numeric configs are negative", () => {
    const result = runEnvironmentSubprocess({
      code: "import { ENV } from './src/config/environment.ts'; console.log(String(ENV.sessionBufferLimit) + ':' + String(ENV.wsMaxPayloadBytes));",
      overrides: {
        SESSION_BUFFER_LIMIT: "-10",
        WS_MAX_PAYLOAD_BYTES: "-4096",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("500:16777216");
  });

  test("falls back allowlists in development when insecure defaults are explicitly enabled", () => {
    const result = runEnvironmentSubprocess({
      code: "import { ENV } from './src/config/environment.ts'; console.log([ENV.allowedAgentCommands.length, ENV.allowedTerminalCommands.length, ENV.allowedEnvKeys.length].join(':'));",
      includeRequiredAllowlists: false,
      overrides: {
        NODE_ENV: "development",
        CONFIG_STRICT_ALLOWLIST: "false",
        ALLOW_INSECURE_DEV_DEFAULTS: "true",
        ALLOWED_AGENT_COMMAND_POLICIES: "",
        ALLOWED_TERMINAL_COMMAND_POLICIES: "",
        ALLOWED_AGENT_COMMANDS: "",
        ALLOWED_TERMINAL_COMMANDS: "",
        ALLOWED_ENV_KEYS: "",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1:1:7");
  });

  test("fails fast when strict mode is disabled without explicit insecure override", () => {
    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        NODE_ENV: "development",
        CONFIG_STRICT_ALLOWLIST: "false",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ALLOW_INSECURE_DEV_DEFAULTS=true");
  });

  test("keeps allowlists strict in production runtime", () => {
    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        NODE_ENV: "production",
        ALLOWED_AGENT_COMMAND_POLICIES: "",
        ALLOWED_TERMINAL_COMMAND_POLICIES: "",
        ALLOWED_AGENT_COMMANDS: "",
        ALLOWED_TERMINAL_COMMANDS: "",
        ALLOWED_ENV_KEYS: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid required allowlist configuration");
  });

  test("fails fast when command policies use relative command paths", () => {
    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ALLOWED_AGENT_COMMAND_POLICIES:
          '[{"command":"codex","allowAnyArgs":true}]',
        ALLOWED_TERMINAL_COMMAND_POLICIES:
          '[{"command":"git","allowAnyArgs":true}]',
        ALLOWED_ENV_KEYS: "PATH",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be an absolute path");
  });

  test("loads required boot config from settings.json", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
      },
    });

    const hostPortResult = runEnvironmentSubprocess({
      code: "import { ENV } from './src/config/environment.ts'; console.log(String(ENV.wsHost) + ':' + String(ENV.wsPort));",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
        ALLOWED_AGENT_COMMAND_POLICIES: "",
        ALLOWED_TERMINAL_COMMAND_POLICIES: "",
        ALLOWED_AGENT_COMMANDS: "",
        ALLOWED_TERMINAL_COMMANDS: "",
        ALLOWED_ENV_KEYS: "",
      },
    });

    expect(hostPortResult.status).toBe(0);
    expect(hostPortResult.stdout.trim()).toBe("127.0.0.1:4111");
  });

  test("env vars override settings.json boot config", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "standard",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_PORT: 4111,
      },
    });

    const result = readEnvironmentValueInSubprocess(
      {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
        ALLOWED_AGENT_COMMAND_POLICIES: "",
        ALLOWED_TERMINAL_COMMAND_POLICIES: "",
        WS_PORT: "5222",
        ALLOWED_AGENT_COMMANDS: "",
        ALLOWED_TERMINAL_COMMANDS: "",
        ALLOWED_ENV_KEYS: "",
      },
      "wsPort",
      { includeRequiredAllowlists: false }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("5222");
  });

  test("compiled mode ignores env overrides and uses settings.json values", async () => {
    const overrideCommandPolicy = JSON.stringify([
      { command: process.execPath, allowAnyArgs: true },
    ]);
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "compiled",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
        AUTH_SECRET: "12345678901234567890123456789012-compiled-secret",
      },
    });

    const result = readEnvironmentValueInSubprocess(
      {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
        WS_PORT: "5222",
        ALLOWED_AGENT_COMMAND_POLICIES: overrideCommandPolicy,
        ALLOWED_TERMINAL_COMMAND_POLICIES: overrideCommandPolicy,
        ALLOWED_AGENT_COMMANDS: process.execPath,
        ALLOWED_TERMINAL_COMMANDS: process.execPath,
        ALLOWED_ENV_KEYS: "HOME",
      },
      "wsPort",
      { includeRequiredAllowlists: false }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("4111");
  });

  test("compiled mode fails fast when required boot keys are missing", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "compiled",
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
      },
    });

    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Missing required boot keys for compiled mode"
    );
    expect(result.stderr).toContain("ALLOWED_AGENT_COMMAND_POLICIES");
  });

  test("compiled mode fails fast when auth secret is too short", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "compiled",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
        AUTH_SECRET: "too-short",
      },
    });

    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("minimum 32 characters");
  });

  test("compiled mode fails fast when auth secret uses placeholder value", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "compiled",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
        AUTH_SECRET: "change_me_in_production_with_32_chars_min",
      },
    });

    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("insecure placeholder");
  });

  test("compiled mode fails fast when auth secret uses local-dev marker", async () => {
    const configPath = await writeBootConfigFile({
      boot: {
        mode: "compiled",
        ALLOWED_AGENT_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_TERMINAL_COMMAND_POLICIES: [
          { command: process.execPath, allowAnyArgs: true },
        ],
        ALLOWED_ENV_KEYS: ["PATH"],
        WS_HOST: "127.0.0.1",
        WS_PORT: 4111,
        AUTH_SECRET: "local_dev_secret_rotate_before_production_2026",
      },
    });

    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: configPath,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local-dev secret value");
  });

  test("fails fast on invalid settings.json boot config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "eragear-boot-invalid-"));
    const filePath = path.join(dir, "settings.json");
    await writeFile(filePath, "{invalid-json", "utf8");

    const result = runEnvironmentSubprocess({
      code: "import './src/config/environment.ts';",
      includeRequiredAllowlists: false,
      overrides: {
        ERAGEAR_BOOT_CONFIG_PATH: filePath,
        ALLOWED_AGENT_COMMAND_POLICIES: "",
        ALLOWED_TERMINAL_COMMAND_POLICIES: "",
        ALLOWED_AGENT_COMMANDS: "",
        ALLOWED_TERMINAL_COMMANDS: "",
        ALLOWED_ENV_KEYS: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Failed to load boot config file");
  });
});
