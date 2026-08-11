import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PRIVATE_FILE_MODE = 0o600;
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const STATUS_POLL_MS = 250;
const DAEMON_TASK_NAME = "EragearRuntimeDaemon";
const WINDOWS_TASK_RESTART_COUNT = 999;
const WINDOWS_TASK_RESTART_INTERVAL_MINUTES = 1;
const DAEMON_POLICY_ENV_KEYS = [
  "CONFIG_STRICT_ALLOWLIST",
  "ALLOWED_AGENT_COMMAND_POLICIES",
  "ALLOWED_TERMINAL_COMMAND_POLICIES",
  "ALLOWED_ENV_KEYS",
  "SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS",
] as const;

type DaemonNodeEnvironment = "development" | "production" | "test";

export interface UserRuntimeDaemonEnablementInput {
  desktopMode: "main-thread" | "client-only";
  configuredValue?: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export interface RuntimeDaemonManifest {
  schemaVersion: 1;
  host: "127.0.0.1";
  port: number;
  runtimeUrl: string;
  healthUrl: string;
  tokenPath: string;
  pid: number;
  startedAt: string;
}

export interface RuntimeDaemonPublicStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  platform: NodeJS.Platform;
  endpoint?: string;
  pid?: number;
  startedAt?: string;
  message: string;
}

export interface RuntimeDaemonConnection {
  runtimeUrl: string;
  apiKey: string;
}

interface RuntimeDaemonCommandRunner {
  execute(command: string, args: string[]): Promise<void>;
}

export interface UserRuntimeDaemonControllerOptions {
  repoRoot: string;
  userDataPath: string;
  runtimeStoragePath: string;
  port: number;
  platform?: NodeJS.Platform;
  bunExecutable?: string;
  nodeEnv?: DaemonNodeEnvironment;
  commandRunner?: RuntimeDaemonCommandRunner;
}

class SystemCommandRunner implements RuntimeDaemonCommandRunner {
  async execute(command: string, args: string[]): Promise<void> {
    await execFileAsync(command, args, { windowsHide: true });
  }
}

export class UserRuntimeDaemonController {
  private readonly daemonDir: string;
  private readonly runtimeRoot: string;
  private readonly runtimeStoragePath: string;
  private readonly manifestPath: string;
  private readonly tokenPath: string;
  private readonly lockPath: string;
  private readonly authApiKeyPath: string;
  private readonly port: number;
  private readonly platform: NodeJS.Platform;
  private readonly bunExecutable: string;
  private readonly nodeEnv: DaemonNodeEnvironment;
  private readonly commands: RuntimeDaemonCommandRunner;

  constructor(options: UserRuntimeDaemonControllerOptions) {
    this.daemonDir = path.resolve(options.userDataPath, "runtime-daemon");
    this.runtimeStoragePath = path.resolve(options.runtimeStoragePath);
    this.runtimeRoot = path.join(
      path.resolve(options.repoRoot),
      "packages",
      "runtime"
    );
    this.manifestPath = path.join(this.daemonDir, "endpoint.json");
    this.tokenPath = path.join(this.daemonDir, "token");
    this.lockPath = path.join(this.daemonDir, "runtime.lock");
    this.authApiKeyPath = path.join(this.runtimeStoragePath, "api-key.json");
    this.port = options.port;
    this.platform = options.platform ?? os.platform();
    this.bunExecutable = options.bunExecutable ?? "bun";
    this.nodeEnv = options.nodeEnv ?? "production";
    this.commands = options.commandRunner ?? new SystemCommandRunner();
  }

  async ensureStarted(): Promise<RuntimeDaemonConnection> {
    const current = await this.readConnection();
    if (current) {
      return current;
    }
    await this.install();
    await this.start();
    const connection = await this.waitForConnection();
    if (!connection) {
      throw new Error("User runtime daemon did not become ready in time.");
    }
    return connection;
  }

  async install(): Promise<RuntimeDaemonPublicStatus> {
    this.assertSupported();
    await mkdir(this.daemonDir, { recursive: true });
    if (this.platform === "win32") {
      await this.installWindowsTask();
    } else {
      await this.installSystemdUserService();
    }
    return await this.status();
  }

  async start(): Promise<RuntimeDaemonPublicStatus> {
    this.assertSupported();
    if ((await this.status()).running) {
      return await this.status();
    }
    try {
      if (this.platform === "win32") {
        await this.commands.execute("schtasks.exe", [
          "/Run",
          "/TN",
          DAEMON_TASK_NAME,
        ]);
      } else {
        await this.commands.execute("systemctl", [
          "--user",
          "start",
          "eragear-runtime.service",
        ]);
      }
    } catch {
      this.startDetachedFallback();
    }
    await this.waitForConnection();
    return await this.status();
  }

  async stop(): Promise<RuntimeDaemonPublicStatus> {
    this.assertSupported();
    const manifest = await this.readManifest();
    if (this.platform === "win32") {
      try {
        await this.commands.execute("schtasks.exe", [
          "/End",
          "/TN",
          DAEMON_TASK_NAME,
        ]);
      } catch (error) {
        if (manifest && (await isEndpointHealthy(manifest.healthUrl))) {
          throw error;
        }
      }
      if (
        manifest &&
        ((await isEndpointHealthy(manifest.healthUrl)) ||
          isProcessAlive(manifest.pid))
      ) {
        await this.stopWindowsDaemonProcess(manifest);
      }
    } else {
      await this.commands.execute("systemctl", [
        "--user",
        "stop",
        "eragear-runtime.service",
      ]);
    }
    if (
      manifest &&
      !(await waitForEndpointStopped(manifest.healthUrl, STOP_TIMEOUT_MS))
    ) {
      throw new Error("User runtime daemon did not stop in time.");
    }
    return await this.status();
  }

  async status(): Promise<RuntimeDaemonPublicStatus> {
    const supported = this.platform === "win32" || this.platform === "linux";
    if (!supported) {
      return {
        supported: false,
        installed: false,
        running: false,
        platform: this.platform,
        message:
          "User runtime daemon is currently supported on Windows and Linux.",
      };
    }
    const installed = await this.isInstalled();
    const manifest = await this.readManifest();
    const running = manifest
      ? await isEndpointHealthy(manifest.healthUrl)
      : false;
    let message = "User runtime daemon is not installed.";
    if (installed) {
      message = "User runtime daemon is installed but not ready.";
    }
    if (running) {
      message = "User runtime daemon is ready on loopback.";
    }
    return {
      supported: true,
      installed,
      running,
      platform: this.platform,
      ...(running && manifest
        ? {
            endpoint: manifest.runtimeUrl,
            pid: manifest.pid,
            startedAt: manifest.startedAt,
          }
        : {}),
      message,
    };
  }

  private assertSupported(): void {
    if (!(this.platform === "win32" || this.platform === "linux")) {
      throw new Error("User runtime daemon supports Windows and Linux in v1.");
    }
  }

  private daemonEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.daemonPersistentEnvironment(),
    };
  }

  private daemonPersistentEnvironment(): Record<string, string> {
    return {
      ...resolveDaemonBootSecurityEnvironment(this.nodeEnv, process.env),
      WS_HOST: "127.0.0.1",
      WS_PORT: String(this.port),
      ERAGEAR_RUNTIME_TRANSPORT: "user-daemon",
      ERAGEAR_DAEMON_MANIFEST_PATH: this.manifestPath,
      ERAGEAR_DAEMON_TOKEN_PATH: this.tokenPath,
      ERAGEAR_DAEMON_LOCK_PATH: this.lockPath,
      ERAGEAR_DAEMON_AUTH_API_KEY_PATH: this.authApiKeyPath,
      ERAGEAR_STORAGE_DIR: this.runtimeStoragePath,
      AUTH_DB_PATH: path.join(this.runtimeStoragePath, "auth.sqlite"),
    };
  }

  private startDetachedFallback(): void {
    const child = spawn(
      this.bunExecutable,
      ["run", "src/runtime/daemon-service.ts"],
      {
        cwd: this.runtimeRoot,
        detached: true,
        env: this.daemonEnvironment(),
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();
  }

  private async installWindowsTask(): Promise<void> {
    const launcherPath = path.join(this.daemonDir, "start-runtime.ps1");
    const lines = [
      "$ErrorActionPreference = 'Stop'",
      ...Object.entries(this.daemonPersistentEnvironment()).map(
        ([key, value]) => `$env:${key} = '${escapePowerShell(value)}'`
      ),
      `Set-Location -LiteralPath '${escapePowerShell(this.runtimeRoot)}'`,
      `& '${escapePowerShell(this.bunExecutable)}' run 'src/runtime/daemon-service.ts'`,
    ];
    await writePrivateFile(launcherPath, `${lines.join("\r\n")}\r\n`);
    const taskCommand = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcherPath}"`;
    await this.commands.execute("schtasks.exe", [
      "/Create",
      "/TN",
      DAEMON_TASK_NAME,
      "/SC",
      "ONLOGON",
      "/TR",
      taskCommand,
      "/RL",
      "LIMITED",
      "/F",
    ]);
    await this.commands.execute("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      createWindowsTaskSettingsScript(),
    ]);
  }

  private async installSystemdUserService(): Promise<void> {
    const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
    const servicePath = path.join(serviceDir, "eragear-runtime.service");
    await mkdir(serviceDir, { recursive: true });
    const environmentLines = Object.entries(
      this.daemonPersistentEnvironment()
    ).map(([key, value]) => `Environment=${key}=${escapeSystemd(value)}`);
    const service = [
      "[Unit]",
      "Description=Eragear user runtime daemon",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${escapeSystemd(this.runtimeRoot)}`,
      ...environmentLines,
      `ExecStart=${escapeSystemd(this.bunExecutable)} run src/runtime/daemon-service.ts`,
      "Restart=on-failure",
      "RestartSec=5",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    await writePrivateFile(servicePath, service);
    await this.commands.execute("systemctl", ["--user", "daemon-reload"]);
    await this.commands.execute("systemctl", [
      "--user",
      "enable",
      "eragear-runtime.service",
    ]);
  }

  private async isInstalled(): Promise<boolean> {
    try {
      if (this.platform === "win32") {
        await this.commands.execute("schtasks.exe", [
          "/Query",
          "/TN",
          DAEMON_TASK_NAME,
        ]);
      } else {
        await this.commands.execute("systemctl", [
          "--user",
          "is-enabled",
          "eragear-runtime.service",
        ]);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async waitForConnection(): Promise<RuntimeDaemonConnection | null> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const connection = await this.readConnection();
      if (connection) {
        return connection;
      }
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    }
    return null;
  }

  private async stopWindowsDaemonProcess(
    manifest: RuntimeDaemonManifest
  ): Promise<void> {
    if (manifest.pid === process.pid) {
      throw new Error("Refusing to stop the current Electron process.");
    }
    try {
      process.kill(manifest.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
    const gracefulEndpointStop = await waitForEndpointStopped(
      manifest.healthUrl,
      STOP_TIMEOUT_MS / 2
    );
    const gracefulProcessStop = await waitForProcessStopped(
      manifest.pid,
      STOP_TIMEOUT_MS / 2
    );
    if (!(gracefulEndpointStop && gracefulProcessStop)) {
      try {
        await this.commands.execute("taskkill.exe", [
          "/PID",
          String(manifest.pid),
          "/T",
          "/F",
        ]);
      } catch (error) {
        if (await isEndpointHealthy(manifest.healthUrl)) {
          throw error;
        }
      }
    }
    const forcedEndpointStop = await waitForEndpointStopped(
      manifest.healthUrl,
      STOP_TIMEOUT_MS / 2
    );
    const forcedProcessStop = await waitForProcessStopped(
      manifest.pid,
      STOP_TIMEOUT_MS / 2
    );
    if (!(forcedEndpointStop && forcedProcessStop)) {
      throw new Error("Windows user runtime daemon process did not stop.");
    }
    await rm(this.manifestPath, { force: true });
    await rm(this.lockPath, { force: true });
  }

  private async readConnection(): Promise<RuntimeDaemonConnection | null> {
    const manifest = await this.readManifest();
    if (!(manifest && (await isEndpointHealthy(manifest.healthUrl)))) {
      return null;
    }
    try {
      const apiKey = (await readFile(manifest.tokenPath, "utf8")).trim();
      if (apiKey.length < 32) {
        return null;
      }
      return { runtimeUrl: manifest.runtimeUrl, apiKey };
    } catch {
      return null;
    }
  }

  private async readManifest(): Promise<RuntimeDaemonManifest | null> {
    try {
      return parseRuntimeDaemonManifest(
        await readFile(this.manifestPath, "utf8")
      );
    } catch {
      return null;
    }
  }
}

export function shouldEnableUserRuntimeDaemon(
  input: UserRuntimeDaemonEnablementInput
): boolean {
  if (
    input.desktopMode !== "main-thread" ||
    (input.platform !== "win32" && input.platform !== "linux")
  ) {
    return false;
  }
  const configured = input.configuredValue?.trim();
  return input.isPackaged ? configured !== "0" : configured === "1";
}

export function resolveDaemonBootSecurityEnvironment(
  nodeEnv: DaemonNodeEnvironment,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  const result: Record<string, string> = {
    NODE_ENV: nodeEnv,
    ALLOW_INSECURE_DEV_DEFAULTS:
      nodeEnv === "production"
        ? "false"
        : (env.ALLOW_INSECURE_DEV_DEFAULTS?.trim() ?? "true"),
  };
  for (const key of DAEMON_POLICY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

export function createWindowsTaskSettingsScript(): string {
  return [
    "$settings = New-ScheduledTaskSettingsSet",
    `-RestartCount ${WINDOWS_TASK_RESTART_COUNT}`,
    `-RestartInterval (New-TimeSpan -Minutes ${WINDOWS_TASK_RESTART_INTERVAL_MINUTES})`,
    "-StartWhenAvailable",
    "-ExecutionTimeLimit ([TimeSpan]::Zero)",
    "-AllowStartIfOnBatteries",
    "-DontStopIfGoingOnBatteries",
    "-MultipleInstances IgnoreNew",
    ";",
    `Set-ScheduledTask -TaskName '${DAEMON_TASK_NAME}' -Settings $settings | Out-Null`,
  ].join(" ");
}

export function parseRuntimeDaemonManifest(raw: string): RuntimeDaemonManifest {
  const value = JSON.parse(raw) as Partial<RuntimeDaemonManifest>;
  if (
    value.schemaVersion !== 1 ||
    value.host !== "127.0.0.1" ||
    !(
      Number.isInteger(value.port) &&
      Number(value.port) > 0 &&
      Number(value.port) < 65_536
    ) ||
    value.runtimeUrl !== `ws://127.0.0.1:${value.port}` ||
    value.healthUrl !== `http://127.0.0.1:${value.port}/api/health` ||
    typeof value.tokenPath !== "string" ||
    !path.isAbsolute(value.tokenPath) ||
    !(Number.isInteger(value.pid) && Number(value.pid) > 0) ||
    typeof value.startedAt !== "string"
  ) {
    throw new Error("Invalid user runtime daemon manifest.");
  }
  return value as RuntimeDaemonManifest;
}

async function isEndpointHealthy(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessStopped(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
  return !isProcessAlive(pid);
}

async function waitForEndpointStopped(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isEndpointHealthy(url))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
  return !(await isEndpointHealthy(url));
}

async function writePrivateFile(
  filePath: string,
  value: string
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  await chmod(temporaryPath, PRIVATE_FILE_MODE);
  await rename(temporaryPath, filePath);
  await chmod(filePath, PRIVATE_FILE_MODE);
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}

function escapeSystemd(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(" ", "\\x20");
}
