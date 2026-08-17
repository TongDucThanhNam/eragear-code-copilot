import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentCliAvailability,
  AgentCliId,
  DesktopRemoteConnectCloudflareAccessCredentials,
  DesktopRuntimeBootstrap,
  DesktopRuntimeMode,
  RuntimeChildProcessDiagnostics,
  RuntimeChildProcessState,
  RuntimeDiagnostics,
  RuntimeEndpoint,
  RuntimeHealth,
  RuntimeHealthState,
  RuntimeHost,
  RuntimeSecurityPosture,
  RuntimeServiceAuth,
  RuntimeServiceClientMessage,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceServerMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import { resolveDesktopRuntimeLaunch } from "./runtime-launch.js";

const execFileAsync = promisify(execFile);
const LOOPBACK_HOST = "127.0.0.1";
const DESKTOP_SERVICE_CHANNEL = "eragear-desktop-runtime-service";
const ELECTRON_IPC_CHANNEL = "eragear-desktop-ipc";
const VERSION_TIMEOUT_MS = 2000;
const SERVICE_READY_TIMEOUT_MS = 60_000;
const SERVICE_REQUEST_TIMEOUT_MS = 120_000;
const LINE_SPLIT_PATTERN = /\r?\n/;

interface AgentCliDefinition {
  id: AgentCliId;
  displayName: string;
  command: string;
  installHint: string;
}

interface DesktopCommandPolicy {
  command: string;
  allowAnyArgs?: boolean;
  allowedArgs?: string[];
  allowedArgPatterns?: string[];
}

const AGENT_CLIS: AgentCliDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    command: "codex",
    installHint:
      "Install and authenticate the Codex CLI, then ensure `codex` is on PATH.",
  },
  {
    id: "claude",
    displayName: "Claude Code",
    command: "claude",
    installHint:
      "Install and authenticate Claude Code, then ensure `claude` is on PATH.",
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    command: "gemini",
    installHint:
      "Install and authenticate Gemini CLI, then ensure `gemini` is on PATH.",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    installHint:
      "Install and authenticate OpenCode, then ensure `opencode` is on PATH.",
  },
];

const AGENT_COMMAND_POLICIES_KEY = "ALLOWED_AGENT_COMMAND_POLICIES";
const ALLOWED_ENV_KEYS_KEY = "ALLOWED_ENV_KEYS";
const DESKTOP_DEFAULT_ALLOWED_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "BUN_ENV",
  "TERM",
  "SHELL",
  "DEBUG",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export interface DesktopRuntimeHostOptions {
  mode: DesktopRuntimeMode;
  repoRoot: string;
  runtimeRoot?: string;
  runtimeExecutable?: string;
  runtimeStoragePath?: string;
  rendererUrl: string;
  runtimePort: number;
  localAuthToken: string;
  remoteRuntimeUrl: string;
  remoteApiKey?: string;
  remoteConnectToken?: string;
  remoteConnectCloudflareAccess?: DesktopRemoteConnectCloudflareAccessCredentials;
  securityPosture?: RuntimeSecurityPosture;
}

interface PendingResponse {
  resolve: (message: RuntimeServiceResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type SubscriptionHandler = (
  event: RuntimeServiceSubscriptionEventMessage["event"]
) => void;

const desktopServiceEndpoint: RuntimeEndpoint = {
  kind: "desktop-service",
  channelName: DESKTOP_SERVICE_CHANNEL,
  networkExposed: false,
  description:
    "Electron main owns a private stdio service channel to the Bun runtime core.",
};

const electronIpcEndpoint: RuntimeEndpoint = {
  kind: "electron-ipc",
  channelName: ELECTRON_IPC_CHANNEL,
  networkExposed: false,
  description:
    "Renderer calls preload IPC; Electron main routes requests to the desktop runtime service.",
};

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function defaultPortForProtocol(protocol: string): number {
  if (protocol === "wss:") {
    return 443;
  }
  return 80;
}

function endpointFromUrl(
  runtimeUrl: string,
  fallbackPort: number,
  kind: RuntimeEndpoint["kind"] = "remote-http"
): RuntimeEndpoint {
  try {
    const parsed = new URL(runtimeUrl);
    const port = parsed.port
      ? Number(parsed.port)
      : defaultPortForProtocol(parsed.protocol);
    const httpProtocol = parsed.protocol === "wss:" ? "https:" : "http:";
    return {
      kind,
      runtimeUrl,
      healthUrl: `${httpProtocol}//${parsed.host}/api/health`,
      host: parsed.hostname,
      port,
      boundToLoopback: isLoopbackHost(parsed.hostname),
      networkExposed: true,
      description:
        kind === "local-http-fallback"
          ? "Explicit loopback-only HTTP compatibility fallback."
          : "Remote/server HTTP, tRPC, and WebSocket runtime.",
    };
  } catch {
    return {
      kind,
      runtimeUrl,
      host: LOOPBACK_HOST,
      port: fallbackPort,
      boundToLoopback: true,
      networkExposed: true,
      description: "HTTP runtime URL could not be parsed.",
    };
  }
}

function resolveExecutable(command: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function firstOutputLine(stdout: string, stderr: string): string | undefined {
  return `${stdout}\n${stderr}`
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

async function readCliVersion(
  executablePath: string
): Promise<string | undefined> {
  try {
    const result = await execFileAsync(executablePath, ["--version"], {
      timeout: VERSION_TIMEOUT_MS,
      windowsHide: true,
    });
    return firstOutputLine(result.stdout, result.stderr);
  } catch {
    return undefined;
  }
}

async function resolveAgentCliAvailability(): Promise<AgentCliAvailability[]> {
  const results: AgentCliAvailability[] = [];

  for (const definition of AGENT_CLIS) {
    const executablePath = resolveExecutable(definition.command);
    if (!executablePath) {
      results.push({
        id: definition.id,
        displayName: definition.displayName,
        command: definition.command,
        available: false,
        message: `${definition.displayName} CLI was not found on PATH.`,
        installHint: definition.installHint,
      });
      continue;
    }

    const version = await readCliVersion(executablePath);
    results.push({
      id: definition.id,
      displayName: definition.displayName,
      command: definition.command,
      available: true,
      executablePath,
      ...(version ? { version } : {}),
      message: version
        ? `${definition.displayName} CLI detected: ${version}`
        : `${definition.displayName} CLI detected; version command did not return a value.`,
      installHint: definition.installHint,
    });
  }

  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePolicyCommand(command: string): string {
  return process.platform === "win32" ? command.toLowerCase() : command;
}

function parseCommandPolicies(raw: unknown): DesktopCommandPolicy[] {
  let value = raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const policies: DesktopCommandPolicy[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.command !== "string") {
      continue;
    }
    const command = entry.command.trim();
    if (!path.isAbsolute(command)) {
      continue;
    }
    policies.push({
      command,
      ...(typeof entry.allowAnyArgs === "boolean"
        ? { allowAnyArgs: entry.allowAnyArgs }
        : {}),
      ...(Array.isArray(entry.allowedArgs)
        ? {
            allowedArgs: entry.allowedArgs.filter(
              (arg): arg is string => typeof arg === "string"
            ),
          }
        : {}),
      ...(Array.isArray(entry.allowedArgPatterns)
        ? {
            allowedArgPatterns: entry.allowedArgPatterns.filter(
              (arg): arg is string => typeof arg === "string"
            ),
          }
        : {}),
    });
  }
  return policies;
}

function readBootObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      return null;
    }
    return isRecord(parsed.boot) ? parsed.boot : parsed;
  } catch {
    return null;
  }
}

function getBootConfigCandidates(serverRoot: string): string[] {
  const explicit = process.env.ERAGEAR_BOOT_CONFIG_PATH?.trim();
  const candidates = explicit
    ? [
        path.isAbsolute(explicit)
          ? explicit
          : path.resolve(serverRoot, explicit),
      ]
    : [
        path.resolve(serverRoot, "settings.json"),
        path.resolve(serverRoot, ".eragear", "settings.json"),
      ];
  return [...new Set(candidates)];
}

function readBootAgentCommandPolicies(
  serverRoot: string
): DesktopCommandPolicy[] {
  for (const candidate of getBootConfigCandidates(serverRoot)) {
    if (!existsSync(candidate)) {
      continue;
    }
    const boot = readBootObject(candidate);
    if (!boot) {
      continue;
    }
    return parseCommandPolicies(boot[AGENT_COMMAND_POLICIES_KEY]);
  }
  return [];
}

function mergeCommandPolicies(
  policySets: DesktopCommandPolicy[][]
): DesktopCommandPolicy[] {
  const merged: DesktopCommandPolicy[] = [];
  const seen = new Set<string>();

  for (const policies of policySets) {
    for (const policy of policies) {
      const command = policy.command.trim();
      if (!path.isAbsolute(command)) {
        continue;
      }
      const key = normalizePolicyCommand(command);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ ...policy, command });
    }
  }

  return merged;
}

function buildDetectedCliPolicies(
  cliAvailability: AgentCliAvailability[]
): DesktopCommandPolicy[] {
  return cliAvailability
    .filter(
      (cli): cli is AgentCliAvailability & { executablePath: string } =>
        cli.available &&
        typeof cli.executablePath === "string" &&
        path.isAbsolute(cli.executablePath)
    )
    .map((cli) => ({
      command: cli.executablePath,
      allowAnyArgs: true,
    }));
}

function buildDesktopAgentCommandPoliciesEnv(input: {
  cliAvailability: AgentCliAvailability[];
  serverRoot: string;
}): string | undefined {
  const policies = mergeCommandPolicies([
    parseCommandPolicies(process.env[AGENT_COMMAND_POLICIES_KEY]),
    readBootAgentCommandPolicies(input.serverRoot),
    buildDetectedCliPolicies(input.cliAvailability),
  ]);

  return policies.length > 0 ? JSON.stringify(policies) : undefined;
}

function parseEnvKeys(raw: unknown): string[] {
  let value = raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = trimmed;
      }
    }
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readBootAllowedEnvKeys(serverRoot: string): string[] {
  for (const candidate of getBootConfigCandidates(serverRoot)) {
    if (!existsSync(candidate)) {
      continue;
    }
    const boot = readBootObject(candidate);
    if (!boot) {
      continue;
    }
    return parseEnvKeys(boot[ALLOWED_ENV_KEYS_KEY]);
  }
  return [];
}

function mergeEnvKeys(keySets: string[][]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const keys of keySets) {
    for (const key of keys) {
      const normalized = key.trim();
      if (!normalized) {
        continue;
      }
      const dedupeKey =
        process.platform === "win32" ? normalized.toLowerCase() : normalized;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push(normalized);
    }
  }
  return merged;
}

function buildDesktopAllowedEnvKeysEnv(serverRoot: string): string {
  return mergeEnvKeys([
    parseEnvKeys(process.env[ALLOWED_ENV_KEYS_KEY]),
    readBootAllowedEnvKeys(serverRoot),
    [...DESKTOP_DEFAULT_ALLOWED_ENV_KEYS],
  ]).join(",");
}

async function terminateWindowsTree(pid: number): Promise<void> {
  try {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
  } catch {
    // Process tree may already be gone after the runtime handled SIGTERM.
  }
}

export class DesktopRuntimeHost
  implements RuntimeHost<DesktopRuntimeBootstrap>
{
  private readonly options: DesktopRuntimeHostOptions;
  private readonly messages: string[] = [];
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private readonly subscriptionHandlers = new Map<
    string,
    SubscriptionHandler
  >();
  private runtimeProcess: ChildProcess | null = null;
  private childStatus: RuntimeChildProcessState = "not-started";
  private healthState: RuntimeHealthState = "not-started";
  private startedAt: string | undefined;
  private stoppedAt: string | undefined;
  private exitCode: number | null | undefined;
  private exitSignal: string | null | undefined;
  private cliAvailability: AgentCliAvailability[] = [];
  private stdoutBuffer = "";
  private readyResolve: ((diagnostics: RuntimeDiagnostics) => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private lastServiceDiagnostics: RuntimeDiagnostics | null = null;

  constructor(options: DesktopRuntimeHostOptions) {
    this.options = options;
  }

  async start(): Promise<RuntimeDiagnostics> {
    if (this.options.mode === "client-only") {
      this.healthState = this.options.remoteRuntimeUrl ? "ready" : "error";
      this.childStatus = "stopped";
      this.addMessage(
        this.options.remoteRuntimeUrl
          ? "Client-only mode: local runtime service skipped."
          : "Client-only mode requires ERAGEAR_REMOTE_SERVER_URL."
      );
      return await this.diagnostics();
    }

    if (this.runtimeProcess) {
      return await this.diagnostics();
    }

    this.childStatus = "starting";
    this.healthState = "starting";
    this.startedAt = new Date().toISOString();
    this.cliAvailability = await resolveAgentCliAvailability();
    this.logCliAvailability();

    const runtimeRoot =
      this.options.runtimeRoot ??
      path.join(this.options.repoRoot, "packages", "runtime");
    const runtimeExecutable = this.options.runtimeExecutable?.trim();
    const launch = resolveDesktopRuntimeLaunch({
      role: "desktop-service",
      runtimeRoot,
      ...(runtimeExecutable ? { runtimeExecutable } : {}),
    });
    try {
      await access(launch.requiredFile);
    } catch (error) {
      this.childStatus = "error";
      this.healthState = "error";
      this.addMessage(
        `Desktop runtime service entrypoint is unavailable at ${launch.requiredFile}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return await this.diagnostics();
    }

    try {
      const isPackagedRuntime = Boolean(runtimeExecutable);
      const serviceEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: isPackagedRuntime ? "production" : "development",
        BUN_ENV: isPackagedRuntime ? "production" : "development",
        ALLOW_INSECURE_DEV_DEFAULTS:
          process.env.ALLOW_INSECURE_DEV_DEFAULTS ??
          (isPackagedRuntime ? "false" : "true"),
        ERAGEAR_RUNTIME_TRANSPORT: "desktop-service",
        ERAGEAR_DESKTOP_SERVICE_TOKEN: this.options.localAuthToken,
        ERAGEAR_REPO_ROOT: this.options.repoRoot,
        ALLOWED_ENV_KEYS: buildDesktopAllowedEnvKeysEnv(runtimeRoot),
        ...(this.options.runtimeStoragePath
          ? { ERAGEAR_STORAGE_DIR: this.options.runtimeStoragePath }
          : {}),
      };
      const agentCommandPoliciesEnv = buildDesktopAgentCommandPoliciesEnv({
        cliAvailability: this.cliAvailability,
        serverRoot: runtimeRoot,
      });
      if (agentCommandPoliciesEnv) {
        serviceEnv.ALLOWED_AGENT_COMMAND_POLICIES = agentCommandPoliciesEnv;
      }

      const proc = spawn(launch.command, launch.args, {
        cwd: runtimeRoot,
        stdio: ["pipe", "pipe", "pipe"],
        env: serviceEnv,
      });

      this.runtimeProcess = proc;
      this.childStatus = "running";
      proc.stdout?.on("data", (chunk) => this.appendServiceStdout(chunk));
      proc.stderr?.on("data", (chunk) =>
        this.appendRuntimeLog("[runtime:service]", chunk)
      );
      proc.once("exit", (code, signal) => {
        this.exitCode = code;
        this.exitSignal = signal;
        this.stoppedAt = new Date().toISOString();
        this.childStatus =
          this.childStatus === "stopping" ? "stopped" : "exited";
        this.healthState = "stopped";
        const suffix = signal ? `signal ${signal}` : `code ${code ?? 0}`;
        this.addMessage(`Desktop runtime service exited with ${suffix}.`);
        this.rejectPendingResponses(
          new Error(`Desktop runtime service exited with ${suffix}.`)
        );
      });
      proc.once("error", (error) => {
        this.childStatus = "error";
        this.healthState = "error";
        this.addMessage(
          `Desktop runtime service failed to start: ${error.message}`
        );
        this.readyReject?.(error);
        this.rejectPendingResponses(error);
      });
    } catch (error) {
      this.childStatus = "error";
      this.healthState = "error";
      this.addMessage(
        `Desktop runtime service spawn failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return await this.diagnostics();
    }

    try {
      const diagnostics = await this.waitForServiceReady();
      this.healthState = "ready";
      this.addMessage("Desktop runtime service channel is ready.");
      return diagnostics;
    } catch (error) {
      this.healthState = "degraded";
      this.addMessage(
        `Desktop runtime service did not become ready: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return await this.diagnostics();
    }
  }

  async stop(): Promise<void> {
    if (this.options.mode === "client-only") {
      return;
    }
    if (!this.runtimeProcess || this.childStatus === "stopped") {
      return;
    }

    const processToStop = this.runtimeProcess;
    this.childStatus = "stopping";
    this.healthState = "stopping";
    this.addMessage("Stopping desktop runtime service.");

    try {
      await this.sendResponseRequest(
        {
          kind: "shutdown",
          id: randomUUID(),
          reason: "SIGTERM",
        },
        10_000
      );
    } catch (error) {
      this.addMessage(
        `Desktop runtime graceful shutdown did not complete: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const exited = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10_000);
      processToStop.once("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    if (!exited && processToStop.pid) {
      if (process.platform === "win32") {
        await terminateWindowsTree(processToStop.pid);
      } else {
        processToStop.kill("SIGKILL");
      }
      this.childStatus = "stopped";
      this.healthState = "stopped";
      this.stoppedAt = new Date().toISOString();
    }
  }

  health(): RuntimeHealth {
    const ready = this.healthState === "ready";
    return {
      state: this.healthState,
      ready,
      checkedAt: new Date().toISOString(),
      message: ready
        ? "Runtime service is ready."
        : `Runtime service is ${this.healthState}.`,
    };
  }

  async diagnostics(): Promise<RuntimeDiagnostics> {
    if (this.options.mode === "main-thread" && this.healthState === "ready") {
      try {
        const response = await this.sendResponseRequest({
          kind: "diagnostics",
          id: randomUUID(),
        });
        if (response.ok && response.data) {
          this.lastServiceDiagnostics = response.data as RuntimeDiagnostics;
        }
      } catch (error) {
        this.addMessage(
          `Desktop runtime diagnostics request failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return this.snapshotDiagnostics();
  }

  getBootstrap(): DesktopRuntimeBootstrap {
    const diagnostics = this.snapshotDiagnostics();
    return {
      platform: "electron",
      mode: this.options.mode,
      transport:
        this.options.mode === "main-thread"
          ? electronIpcEndpoint
          : this.endpoint(),
      ...(this.options.mode === "client-only" && diagnostics.endpoint.runtimeUrl
        ? { serverUrl: diagnostics.endpoint.runtimeUrl }
        : {}),
      ...(this.options.mode === "client-only" && this.options.remoteApiKey
        ? { apiKey: this.options.remoteApiKey }
        : {}),
      ...(this.options.mode === "client-only" && this.options.remoteConnectToken
        ? { remoteConnectToken: this.options.remoteConnectToken }
        : {}),
      ...(this.options.mode === "client-only" &&
      this.options.remoteConnectCloudflareAccess
        ? {
            remoteConnectCloudflareAccess:
              this.options.remoteConnectCloudflareAccess,
          }
        : {}),
      ...(this.options.mode === "main-thread"
        ? { localAuthToken: this.options.localAuthToken }
        : {}),
      runtimeReady: diagnostics.health.ready,
      diagnostics: diagnostics.messages,
      runtimeDiagnostics: diagnostics,
    };
  }

  async requestOperation(input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }): Promise<RuntimeServiceResponseMessage> {
    this.validateRendererAuth(input.auth);
    return await this.sendResponseRequest({
      kind: "request",
      id: randomUUID(),
      auth: input.auth,
      operation: input.operation,
    });
  }

  async subscribeOperation(input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
    onEvent: SubscriptionHandler;
  }): Promise<{ subscriptionId: string }> {
    this.validateRendererAuth(input.auth);
    const subscriptionId = randomUUID();
    this.subscriptionHandlers.set(subscriptionId, input.onEvent);
    try {
      this.sendMessage({
        kind: "subscribe",
        id: subscriptionId,
        auth: input.auth,
        operation: input.operation,
      });
      await Promise.resolve();
      return { subscriptionId };
    } catch (error) {
      this.subscriptionHandlers.delete(subscriptionId);
      throw error;
    }
  }

  async unsubscribeOperation(subscriptionId: string): Promise<void> {
    this.subscriptionHandlers.delete(subscriptionId);
    if (!this.runtimeProcess) {
      await Promise.resolve();
      return;
    }
    this.sendMessage({
      kind: "unsubscribe",
      id: subscriptionId,
    });
    await Promise.resolve();
  }

  private endpoint(): RuntimeEndpoint {
    if (this.options.mode === "client-only") {
      return endpointFromUrl(
        this.options.remoteRuntimeUrl,
        this.options.runtimePort,
        this.options.remoteConnectToken
          ? "desktop-remote-connect"
          : "remote-http"
      );
    }
    return desktopServiceEndpoint;
  }

  private snapshotDiagnostics(): RuntimeDiagnostics {
    const serviceDiagnostics = this.lastServiceDiagnostics;
    if (serviceDiagnostics) {
      return {
        ...serviceDiagnostics,
        health: this.health(),
        childProcess: this.childProcessDiagnostics(),
        cliAvailability: [...this.cliAvailability],
        ...(this.options.securityPosture
          ? { securityPosture: this.options.securityPosture }
          : {}),
        messages: [...serviceDiagnostics.messages, ...this.messages],
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      mode: this.options.mode,
      endpoint: this.endpoint(),
      health: this.health(),
      childProcess: this.childProcessDiagnostics(),
      cliAvailability: [...this.cliAvailability],
      ...(this.options.securityPosture
        ? { securityPosture: this.options.securityPosture }
        : {}),
      messages: [...this.messages],
      updatedAt: new Date().toISOString(),
    };
  }

  private childProcessDiagnostics(): RuntimeChildProcessDiagnostics {
    return {
      role: "runtime-host",
      status: this.childStatus,
      ...(this.runtimeProcess?.pid ? { pid: this.runtimeProcess.pid } : {}),
      ...(this.exitCode !== undefined ? { exitCode: this.exitCode } : {}),
      ...(this.exitSignal !== undefined ? { signal: this.exitSignal } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      message: `Desktop runtime service process is ${this.childStatus}.`,
    };
  }

  private validateRendererAuth(auth: RuntimeServiceAuth | undefined): void {
    if (this.options.mode !== "main-thread") {
      return;
    }
    if (auth?.localAuthToken !== this.options.localAuthToken) {
      throw new Error("Invalid desktop IPC local auth token.");
    }
  }

  private logCliAvailability(): void {
    for (const item of this.cliAvailability) {
      if (item.available) {
        console.log(`[desktop] ${item.message}`);
        continue;
      }
      this.addMessage(`${item.message} ${item.installHint}`);
    }
  }

  private appendRuntimeLog(prefix: string, chunk: Buffer): void {
    const text = chunk.toString();
    for (const line of text.split(LINE_SPLIT_PATTERN)) {
      if (line.trim().length > 0) {
        console.log(`${prefix} ${line}`);
      }
    }
  }

  private appendServiceStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString();
    const lines = this.stdoutBuffer.split(LINE_SPLIT_PATTERN);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      this.handleServiceLine(line);
    }
  }

  private handleServiceLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: RuntimeServiceServerMessage;
    try {
      message = JSON.parse(line) as RuntimeServiceServerMessage;
    } catch {
      this.addMessage(`Ignoring non-protocol runtime output: ${line}`);
      return;
    }

    switch (message.kind) {
      case "ready":
        this.lastServiceDiagnostics = message.diagnostics;
        this.healthState = message.diagnostics.health.ready
          ? "ready"
          : message.diagnostics.health.state;
        this.readyResolve?.(this.snapshotDiagnostics());
        this.readyResolve = undefined;
        this.readyReject = undefined;
        return;
      case "fatal": {
        const error = new Error(message.error.message);
        this.healthState = "error";
        this.childStatus = "error";
        this.addMessage(
          `Desktop runtime service fatal error: ${error.message}`
        );
        this.readyReject?.(error);
        this.readyResolve = undefined;
        this.readyReject = undefined;
        return;
      }
      case "response":
        this.resolvePendingResponse(message);
        return;
      case "subscription-event":
        this.subscriptionHandlers.get(message.id)?.(message.event);
        return;
      default:
        this.addMessage("Ignoring unknown desktop runtime service message.");
        return;
    }
  }

  private waitForServiceReady(): Promise<RuntimeDiagnostics> {
    if (this.lastServiceDiagnostics?.health.ready) {
      return Promise.resolve(this.lastServiceDiagnostics);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.readyResolve = undefined;
        this.readyReject = undefined;
        reject(
          new Error(
            `Timed out after ${SERVICE_READY_TIMEOUT_MS}ms waiting for desktop runtime service.`
          )
        );
      }, SERVICE_READY_TIMEOUT_MS);

      this.readyResolve = (diagnostics) => {
        clearTimeout(timeout);
        resolve(diagnostics);
      };
      this.readyReject = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  private sendResponseRequest(
    message: RuntimeServiceClientMessage,
    timeoutMs = SERVICE_REQUEST_TIMEOUT_MS
  ): Promise<RuntimeServiceResponseMessage> {
    if (!("id" in message)) {
      return Promise.reject(
        new Error("Runtime service message requires an id.")
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for desktop runtime response.`
          )
        );
      }, timeoutMs);
      this.pendingResponses.set(message.id, {
        resolve,
        reject,
        timeout,
      });

      try {
        this.sendMessage(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingResponses.delete(message.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private sendMessage(message: RuntimeServiceClientMessage): void {
    const stdin = this.runtimeProcess?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      throw new Error("Desktop runtime service stdin is not writable.");
    }
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private resolvePendingResponse(message: RuntimeServiceResponseMessage): void {
    const pending = this.pendingResponses.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingResponses.delete(message.id);
    pending.resolve(message);
  }

  private rejectPendingResponses(error: Error): void {
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingResponses.delete(id);
    }
    for (const [id, handler] of this.subscriptionHandlers) {
      handler({
        type: "error",
        error: {
          message: error.message,
        },
      });
      this.subscriptionHandlers.delete(id);
    }
  }

  private addMessage(message: string): void {
    this.messages.push(message);
    console.warn(`[desktop] ${message}`);
  }
}
