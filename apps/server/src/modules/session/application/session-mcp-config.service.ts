import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import type { SettingsRepositoryPort } from "@/modules/settings";
import { ValidationError } from "@/shared/errors";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpSseServerConfig,
  McpStdioServerConfig,
} from "@/shared/types/settings.types";

const OP = "session.lifecycle.create";
const PROJECT_MCP_FILE = "mcp-servers.json";
const MCP_AGENT_BROKER_FILE = path.join("runtime", "mcp-agent-broker.js");
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MCP_PROTOCOL_TIMEOUT_MS = 3500;
const MCP_SSE_RECONNECT_ATTEMPTS = 1;
const DEFAULT_MCP_NOTIFICATION_WATCH_MS = 1_000;
const MIN_MCP_REMOTE_REQUEST_TIMEOUT_MS = 1_000;
const MAX_MCP_REMOTE_REQUEST_TIMEOUT_MS = 15_000;
const MIN_MCP_REMOTE_RECONNECT_ATTEMPTS = 0;
const MAX_MCP_REMOTE_RECONNECT_ATTEMPTS = 3;
const MIN_MCP_NOTIFICATION_WATCH_MS = 250;
const MAX_MCP_NOTIFICATION_WATCH_MS = 5_000;
const SECRET_HINT_PATTERN =
  /(api[_-]?key|secret|token|password|private[_-]?key|authorization|cookie)/i;

interface AgentMcpCapabilities {
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  mcp?: { http?: boolean; sse?: boolean };
}

interface ProjectLocalMcpServer {
  id: string;
  name: string;
  transport: "stdio" | "streamable-http" | "sse";
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  messageEndpoint?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
  remoteControls?: Partial<Pick<
    ProjectLocalMcpRemoteControls,
    "requestTimeoutMs" | "reconnectAttempts" | "notificationWatchMs"
  >>;
  trustedFingerprint?: string;
}

interface ProjectLocalMcpRemoteControls {
  requestTimeoutMs: number;
  reconnectAttempts: number;
  notificationWatchMs: number;
  mode: "default" | "custom";
  diagnostics: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJavaScriptRuntimeExecutable(command: string): boolean {
  const basename = path.basename(command).toLowerCase();
  return (
    basename === "bun" ||
    basename === "bun.exe" ||
    basename === "node" ||
    basename === "node.exe"
  );
}

export function resolveMcpAgentBrokerRuntimeCommand(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env.ERAGEAR_MCP_AGENT_BROKER_RUNTIME?.trim();
  if (configured) {
    return configured;
  }
  return isJavaScriptRuntimeExecutable(process.execPath) ? process.execPath : "bun";
}

export function resolveMcpAgentBrokerScript(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  moduleDir?: string;
} = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const moduleDir = options.moduleDir ?? MODULE_DIR;
  const configured = env.ERAGEAR_MCP_AGENT_BROKER_SCRIPT?.trim();
  const candidates = [
    configured ? path.resolve(configured) : undefined,
    path.resolve(moduleDir, "..", "..", "..", MCP_AGENT_BROKER_FILE),
    path.resolve(moduleDir, MCP_AGENT_BROKER_FILE),
    path.resolve(cwd, "src", MCP_AGENT_BROKER_FILE),
    path.resolve(cwd, "dist", MCP_AGENT_BROKER_FILE),
    path.resolve(cwd, "apps", "server", "src", MCP_AGENT_BROKER_FILE),
    path.resolve(cwd, "apps", "server", "dist", MCP_AGENT_BROKER_FILE),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? path.resolve(cwd, "src", MCP_AGENT_BROKER_FILE);
}

function sanitizeRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "string" && key.trim()) {
      result[key.trim()] = rawValue;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function hashSecretMaterial(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortedMcpRecordHashes(
  record: Record<string, string> | undefined
): Array<{ key: string; valueHash: string }> {
  return Object.entries(record ?? {})
    .map(([key, value]) => ({
      key,
      valueHash: hashSecretMaterial(String(value)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function sortedMcpHeaderEnv(
  record: Record<string, string> | undefined
): Array<{ header: string; envKey: string }> {
  return Object.entries(record ?? {})
    .map(([header, envKey]) => ({ header, envKey }))
    .sort((left, right) => left.header.localeCompare(right.header));
}

function clampMcpInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeMcpNotificationWatchMs(value: unknown): number {
  return clampMcpInteger(
    value,
    DEFAULT_MCP_NOTIFICATION_WATCH_MS,
    MIN_MCP_NOTIFICATION_WATCH_MS,
    MAX_MCP_NOTIFICATION_WATCH_MS
  );
}

function normalizeProjectLocalMcpRemoteControls(
  value: unknown
):
  | Pick<
      ProjectLocalMcpRemoteControls,
      "requestTimeoutMs" | "reconnectAttempts" | "notificationWatchMs"
    >
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const requestTimeoutMs = clampMcpInteger(
    value.requestTimeoutMs,
    MCP_PROTOCOL_TIMEOUT_MS,
    MIN_MCP_REMOTE_REQUEST_TIMEOUT_MS,
    MAX_MCP_REMOTE_REQUEST_TIMEOUT_MS
  );
  const reconnectAttempts = clampMcpInteger(
    value.reconnectAttempts,
    MCP_SSE_RECONNECT_ATTEMPTS,
    MIN_MCP_REMOTE_RECONNECT_ATTEMPTS,
    MAX_MCP_REMOTE_RECONNECT_ATTEMPTS
  );
  const notificationWatchMs = normalizeMcpNotificationWatchMs(
    value.notificationWatchMs
  );
  const hasCustom =
    requestTimeoutMs !== MCP_PROTOCOL_TIMEOUT_MS ||
    reconnectAttempts !== MCP_SSE_RECONNECT_ATTEMPTS ||
    notificationWatchMs !== DEFAULT_MCP_NOTIFICATION_WATCH_MS;
  return hasCustom
    ? { requestTimeoutMs, reconnectAttempts, notificationWatchMs }
    : undefined;
}

function visibleProjectLocalMcpRemoteControls(
  server: Pick<ProjectLocalMcpServer, "remoteControls">
): ProjectLocalMcpRemoteControls {
  const controls = normalizeProjectLocalMcpRemoteControls(server.remoteControls);
  return {
    requestTimeoutMs: controls?.requestTimeoutMs ?? MCP_PROTOCOL_TIMEOUT_MS,
    reconnectAttempts: controls?.reconnectAttempts ?? MCP_SSE_RECONNECT_ATTEMPTS,
    notificationWatchMs:
      controls?.notificationWatchMs ?? DEFAULT_MCP_NOTIFICATION_WATCH_MS,
    mode: controls ? "custom" : "default",
    diagnostics: controls
      ? ["MCP remote operational controls are customized for this server."]
      : ["MCP remote operational controls use Eragear defaults."],
  };
}

export function projectLocalMcpFingerprint(
  server: Pick<
    ProjectLocalMcpServer,
    | "transport"
    | "command"
    | "args"
    | "url"
    | "messageEndpoint"
    | "env"
    | "headers"
    | "headerEnv"
    | "remoteControls"
  >
): string {
  const payload = JSON.stringify({
    version: 1,
    transport: server.transport,
    command: server.command?.trim() ?? "",
    args: (server.args ?? []).map((arg) => String(arg)),
    url: server.url?.trim() ?? "",
    messageEndpoint: server.messageEndpoint?.trim() ?? "",
    env: sortedMcpRecordHashes(server.env),
    headers: sortedMcpRecordHashes(server.headers),
    headerEnv: sortedMcpHeaderEnv(server.headerEnv),
    remoteControls: visibleProjectLocalMcpRemoteControls(server),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function hasTrustedProjectLocalFingerprint(server: ProjectLocalMcpServer): boolean {
  return (
    Boolean(server.trustedFingerprint) &&
    server.trustedFingerprint === projectLocalMcpFingerprint(server)
  );
}

function unsafeLiteralMcpHeaderNames(
  headers: Record<string, string> | undefined
): string[] {
  return Object.keys(headers ?? {}).filter((header) =>
    SECRET_HINT_PATTERN.test(header)
  );
}

function parseProjectLocalMcpServer(value: unknown): ProjectLocalMcpServer | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  const transport =
    value.transport === "sse" || value.transport === "streamable-http"
      ? value.transport
      : "stdio";
  const args = Array.isArray(value.args)
    ? value.args.filter((arg): arg is string => typeof arg === "string")
    : undefined;
  return {
    id: value.id,
    name: value.name,
    transport,
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.messageEndpoint === "string"
      ? { messageEndpoint: value.messageEndpoint }
      : {}),
    ...(sanitizeRecord(value.env) ? { env: sanitizeRecord(value.env) } : {}),
    ...(sanitizeRecord(value.headers) ? { headers: sanitizeRecord(value.headers) } : {}),
    ...(sanitizeRecord(value.headerEnv)
      ? { headerEnv: sanitizeRecord(value.headerEnv) }
      : {}),
    ...(normalizeProjectLocalMcpRemoteControls(value.remoteControls)
      ? { remoteControls: normalizeProjectLocalMcpRemoteControls(value.remoteControls) }
      : {}),
    ...(typeof value.trustedFingerprint === "string"
      ? { trustedFingerprint: value.trustedFingerprint }
      : {}),
  };
}

async function readProjectLocalMcpServers(
  projectRoot: string
): Promise<ProjectLocalMcpServer[]> {
  const filePath = path.join(projectRoot, ".eragear", PROJECT_MCP_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.servers)) {
    return [];
  }
  return parsed.servers
    .map(parseProjectLocalMcpServer)
    .filter((server): server is ProjectLocalMcpServer => Boolean(server));
}

function missingHeaderEnvKeys(server: ProjectLocalMcpServer): string[] {
  return Object.values(server.headerEnv ?? {}).filter((envKey) => !process.env[envKey]);
}

function toBrokeredMcpServer(
  projectRoot: string,
  server: ProjectLocalMcpServer
): McpStdioServerConfig {
  const fingerprint = projectLocalMcpFingerprint(server);
  return {
    name: server.name,
    command: resolveMcpAgentBrokerRuntimeCommand(),
    args: [
      resolveMcpAgentBrokerScript(),
      "--project-root",
      projectRoot,
      "--server-id",
      server.id,
      "--fingerprint",
      fingerprint,
    ],
    env: [],
  };
}

function toSettingsMcpServer(
  projectRoot: string,
  server: ProjectLocalMcpServer
): McpServerConfig | null {
  if (!server.enabled || !hasTrustedProjectLocalFingerprint(server)) {
    return null;
  }
  if (server.transport === "stdio") {
    if (!server.command?.trim()) {
      return null;
    }
    return toBrokeredMcpServer(projectRoot, server);
  }

  if (!server.url?.trim()) {
    return null;
  }
  if (
    unsafeLiteralMcpHeaderNames(server.headers).length > 0 ||
    missingHeaderEnvKeys(server).length > 0
  ) {
    return null;
  }
  return toBrokeredMcpServer(projectRoot, server);
}

/**
 * Resolves configured MCP servers against the initialized agent capabilities.
 *
 * Error mode: throws `ValidationError` when settings include HTTP/SSE servers
 * that the agent did not advertise, preventing an invalid ACP initialize call.
 */
export class SessionMcpConfigService {
  private readonly settingsRepo: SettingsRepositoryPort;

  constructor(settingsRepo: SettingsRepositoryPort) {
    this.settingsRepo = settingsRepo;
  }

  toAcpServers(mcpServers: McpServerConfig[]): acp.McpServer[] {
    return mcpServers.map((server) => {
      if (this.isHttpServer(server)) {
        return {
          type: "http" as const,
          name: server.name,
          url: server.url,
          headers: server.headers,
        } satisfies acp.McpServer;
      }

      if (this.isSseServer(server)) {
        return {
          type: "sse" as const,
          name: server.name,
          url: server.url,
          headers: server.headers,
        } satisfies acp.McpServer;
      }

      const stdio = server as McpStdioServerConfig;
      return {
        name: stdio.name,
        command: stdio.command,
        args: stdio.args ?? [],
        env: stdio.env ?? [],
      } satisfies acp.McpServer;
    });
  }

  async resolveServers(
    projectRoot: string,
    agentCapabilities?: AgentMcpCapabilities
  ): Promise<McpServerConfig[]> {
    const { mcpServers } = await this.settingsRepo.get();
    const projectLocalMcpServers = (await readProjectLocalMcpServers(projectRoot))
      .map((server) => toSettingsMcpServer(projectRoot, server))
      .filter((server): server is McpServerConfig => Boolean(server));
    const resolvedServers = [...(mcpServers ?? []), ...projectLocalMcpServers];
    if (resolvedServers.length === 0) {
      return [];
    }

    const mcpCaps =
      agentCapabilities?.mcpCapabilities ?? agentCapabilities?.mcp;
    const httpSupported = Boolean(mcpCaps?.http);
    const sseSupported = Boolean(mcpCaps?.sse);

    const blocked = resolvedServers.filter((server) => {
      if (this.isHttpServer(server)) {
        return !httpSupported;
      }
      if (this.isSseServer(server)) {
        return !sseSupported;
      }
      return false;
    });

    if (blocked.length > 0) {
      const blockedNames = blocked.map((server) => server.name).join(", ");
      throw new ValidationError(
        `Agent does not support MCP transports for: ${blockedNames}`,
        {
          module: "session",
          op: OP,
          details: { blockedNames },
        }
      );
    }

    return resolvedServers;
  }

  private isHttpServer(server: McpServerConfig): server is McpHttpServerConfig {
    return "type" in server && server.type === "http";
  }

  private isSseServer(server: McpServerConfig): server is McpSseServerConfig {
    return "type" in server && server.type === "sse";
  }
}
