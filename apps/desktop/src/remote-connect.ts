import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  DesktopRemoteConnectBridgeStatus,
  DesktopRemoteConnectStatus,
  DesktopRemoteConnectTunnelMode,
  DesktopRemoteConnectTunnelStatus,
  RuntimeServiceAuth,
  RuntimeServiceOperation,
  RuntimeServiceResponseMessage,
  RuntimeServiceSubscriptionEventMessage,
} from "@eragear-code-copilot/shared";
import {
  createDefaultDesktopSettings,
  type DesktopRemoteConnectSettings,
} from "./desktop-settings.js";

const DEFAULT_REMOTE_CONNECT_HOST = "127.0.0.1";
const DEFAULT_REMOTE_CONNECT_BODY_LIMIT_BYTES = 512 * 1024;
const MIN_REMOTE_CONNECT_TOKEN_LENGTH = 32;
const QUICK_TUNNEL_URL_PATTERN =
  /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\b/;
const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;
const REMOTE_TOKEN_HEADER = "x-eragear-remote-token";
const CF_ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";
const CF_ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret";

export interface RemoteConnectRuntime {
  requestOperation(input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
  }): Promise<RuntimeServiceResponseMessage>;
  subscribeOperation(input: {
    auth?: RuntimeServiceAuth;
    operation: RuntimeServiceOperation;
    onEvent: (event: RuntimeServiceSubscriptionEventMessage["event"]) => void;
  }): Promise<{ subscriptionId: string }>;
  unsubscribeOperation(subscriptionId: string): Promise<void>;
}

interface CloudflareAccessServiceTokenConfig {
  clientId: string;
  clientSecret: string;
}

interface RemoteConnectTunnelConfig {
  mode: DesktopRemoteConnectTunnelMode;
  executablePath: string;
  token?: string;
  publicUrl?: string;
  noAutoupdate: boolean;
}

export interface RemoteConnectConfig {
  enabled: boolean;
  host: string;
  port: number;
  accessToken: string;
  allowedOrigins: string[];
  bodyLimitBytes: number;
  cloudflareAccess?: CloudflareAccessServiceTokenConfig;
  tunnel: RemoteConnectTunnelConfig;
  validationErrors: string[];
}

export interface RemoteConnectHostOptions {
  config: RemoteConnectConfig;
  runtime: RemoteConnectRuntime;
  trustedRuntimeAuth: RuntimeServiceAuth;
  now?: () => Date;
}

export function resolveRemoteConnectConfig(
  env: NodeJS.ProcessEnv = process.env
): RemoteConnectConfig {
  return resolveRemoteConnectConfigFromSettings(
    createDefaultDesktopSettings(env).remoteConnect
  );
}

export function resolveRemoteConnectConfigFromSettings(
  settings: DesktopRemoteConnectSettings
): RemoteConnectConfig {
  const enabled = settings.enabled;
  const host = settings.host.trim() || DEFAULT_REMOTE_CONNECT_HOST;
  const port = settings.port;
  const accessToken = settings.accessToken.trim();
  const bodyLimitBytes =
    settings.bodyLimitBytes > 0
      ? settings.bodyLimitBytes
      : DEFAULT_REMOTE_CONNECT_BODY_LIMIT_BYTES;
  const allowedOrigins = settings.allowedOrigins;
  const tunnelMode = settings.tunnelMode;
  const tunnelToken = settings.tunnelToken.trim();
  const cloudflareAccessClientId = settings.cloudflareAccessClientId.trim();
  const cloudflareAccessClientSecret =
    settings.cloudflareAccessClientSecret.trim();
  const validationErrors: string[] = [];

  if (enabled && !isLoopbackHost(host)) {
    validationErrors.push("Remote Connect host must be loopback-only.");
  }
  if (enabled && accessToken.length < MIN_REMOTE_CONNECT_TOKEN_LENGTH) {
    validationErrors.push(
      `Remote Connect token must be at least ${MIN_REMOTE_CONNECT_TOKEN_LENGTH} characters.`
    );
  }
  if (
    enabled &&
    tunnelMode === "named" &&
    tunnelToken.length < MIN_REMOTE_CONNECT_TOKEN_LENGTH
  ) {
    validationErrors.push(
      "Cloudflared tunnel token is required for named tunnels."
    );
  }
  if (
    (cloudflareAccessClientId.length > 0 ||
      cloudflareAccessClientSecret.length > 0) &&
    !(
      cloudflareAccessClientId.length > 0 &&
      cloudflareAccessClientSecret.length > 0
    )
  ) {
    validationErrors.push(
      "Cloudflare Access client id and secret must be set together."
    );
  }

  return {
    enabled,
    host,
    port,
    accessToken,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    bodyLimitBytes,
    ...(cloudflareAccessClientId && cloudflareAccessClientSecret
      ? {
          cloudflareAccess: {
            clientId: cloudflareAccessClientId,
            clientSecret: cloudflareAccessClientSecret,
          },
        }
      : {}),
    tunnel: {
      mode: tunnelMode,
      executablePath: settings.cloudflaredPath.trim() || "cloudflared",
      ...(tunnelToken ? { token: tunnelToken } : {}),
      ...(settings.tunnelPublicUrl.trim()
        ? { publicUrl: settings.tunnelPublicUrl.trim() }
        : {}),
      noAutoupdate: settings.cloudflaredNoAutoupdate,
    },
    validationErrors,
  };
}

export function buildCloudflaredArgs(
  tunnel: RemoteConnectTunnelConfig,
  serviceUrl: string
): string[] {
  if (tunnel.mode === "quick") {
    return [
      "tunnel",
      "--url",
      serviceUrl,
      ...(tunnel.noAutoupdate ? ["--no-autoupdate"] : []),
    ];
  }

  if (tunnel.mode === "named") {
    return [
      "tunnel",
      ...(tunnel.noAutoupdate ? ["--no-autoupdate"] : []),
      "run",
      "--token",
      tunnel.token ?? "",
    ];
  }

  return [];
}

export function parseTryCloudflareUrl(text: string): string | undefined {
  return text.match(QUICK_TUNNEL_URL_PATTERN)?.[0];
}

export class DesktopRemoteConnectHost {
  private readonly config: RemoteConnectConfig;
  private readonly runtime: RemoteConnectRuntime;
  private readonly trustedRuntimeAuth: RuntimeServiceAuth;
  private readonly now: () => Date;
  private readonly bridge: RemoteConnectBridge;
  private readonly tunnel: CloudflaredTunnelProcess;
  private messages: string[] = [];

  constructor(options: RemoteConnectHostOptions) {
    this.config = options.config;
    this.runtime = options.runtime;
    this.trustedRuntimeAuth = options.trustedRuntimeAuth;
    this.now = options.now ?? (() => new Date());
    this.bridge = new RemoteConnectBridge({
      config: this.config,
      runtime: this.runtime,
      trustedRuntimeAuth: this.trustedRuntimeAuth,
      now: this.now,
    });
    this.tunnel = new CloudflaredTunnelProcess(this.config.tunnel, this.now);
  }

  async start(): Promise<DesktopRemoteConnectStatus> {
    if (!this.config.enabled) {
      this.messages = ["Remote Connect is disabled."];
      return this.status();
    }

    if (this.config.validationErrors.length > 0) {
      this.messages = [...this.config.validationErrors];
      this.bridge.markError(this.config.validationErrors.join(" "));
      return this.status();
    }

    const localUrl = await this.bridge.start();
    this.messages = [
      `Remote Connect bridge is listening on ${localUrl}.`,
      this.config.cloudflareAccess
        ? "Cloudflare Access service-token headers are required."
        : "Cloudflare Access service-token headers are not configured.",
    ];

    if (this.config.tunnel.mode !== "off") {
      await this.tunnel.start(localUrl);
    }

    return this.status();
  }

  async stop(): Promise<void> {
    await this.tunnel.stop();
    await this.bridge.stop();
  }

  status(): DesktopRemoteConnectStatus {
    return {
      enabled: this.config.enabled,
      bridge: this.bridge.status(),
      tunnel: this.tunnel.status(),
      messages: [
        ...this.messages,
        ...this.bridge.messages(),
        ...this.tunnel.messages(),
      ],
      updatedAt: this.now().toISOString(),
    };
  }
}

interface RemoteConnectBridgeOptions {
  config: RemoteConnectConfig;
  runtime: RemoteConnectRuntime;
  trustedRuntimeAuth: RuntimeServiceAuth;
  now: () => Date;
}

class RemoteConnectBridge {
  private readonly config: RemoteConnectConfig;
  private readonly runtime: RemoteConnectRuntime;
  private readonly trustedRuntimeAuth: RuntimeServiceAuth;
  private readonly now: () => Date;
  private server: Server | null = null;
  private bridgeStatus: DesktopRemoteConnectBridgeStatus;
  private readonly bridgeMessages: string[] = [];

  constructor(options: RemoteConnectBridgeOptions) {
    this.config = options.config;
    this.runtime = options.runtime;
    this.trustedRuntimeAuth = options.trustedRuntimeAuth;
    this.now = options.now;
    this.bridgeStatus = {
      state: this.config.enabled ? "stopped" : "disabled",
      host: this.config.host,
      port: this.config.port || undefined,
      authRequired: true,
      cloudflareAccessRequired: Boolean(this.config.cloudflareAccess),
      corsAllowedOrigins: [...this.config.allowedOrigins],
    };
  }

  async start(): Promise<string> {
    if (this.server) {
      return this.localUrl();
    }

    this.bridgeStatus = {
      ...this.bridgeStatus,
      state: "starting",
      error: undefined,
    };
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        writeJson(
          req,
          res,
          500,
          {
            error: error instanceof Error ? error.message : String(error),
          },
          this.config.allowedOrigins
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error("Remote Connect bridge server was not created."));
        return;
      }
      server.once("error", reject);
      server.listen(this.config.port, this.config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.bridgeStatus = {
      ...this.bridgeStatus,
      state: "ready",
      host: this.config.host,
      port: this.boundPort(),
      localUrl: this.localUrl(),
      startedAt: this.now().toISOString(),
      stoppedAt: undefined,
      error: undefined,
    };
    return this.localUrl();
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.bridgeStatus = {
        ...this.bridgeStatus,
        state: this.config.enabled ? "stopped" : "disabled",
        stoppedAt: this.now().toISOString(),
      };
      return;
    }
    this.bridgeStatus = { ...this.bridgeStatus, state: "stopping" };
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.bridgeStatus = {
      ...this.bridgeStatus,
      state: "stopped",
      stoppedAt: this.now().toISOString(),
    };
  }

  markError(error: string): void {
    this.bridgeStatus = {
      ...this.bridgeStatus,
      state: "error",
      error,
    };
  }

  status(): DesktopRemoteConnectBridgeStatus {
    return {
      ...this.bridgeStatus,
      corsAllowedOrigins: [...this.bridgeStatus.corsAllowedOrigins],
    };
  }

  messages(): string[] {
    return [...this.bridgeMessages];
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (req.method === "OPTIONS") {
      writeEmptyOptions(req, res, this.config.allowedOrigins);
      return;
    }

    const pathname = requestPathname(req);
    if (req.method === "GET" && pathname === "/api/health") {
      writeJson(
        req,
        res,
        200,
        { ok: true, ts: Date.now() },
        this.config.allowedOrigins
      );
      return;
    }

    const authResult = this.authorize(req);
    if (!authResult.ok) {
      writeJson(
        req,
        res,
        authResult.status,
        { error: authResult.message },
        this.config.allowedOrigins
      );
      return;
    }

    if (req.method === "GET" && pathname === "/api/remote-connect/status") {
      writeJson(req, res, 200, this.status(), this.config.allowedOrigins);
      return;
    }

    if (req.method === "POST" && pathname === "/api/remote-connect/request") {
      await this.handleRuntimeRequest(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/remote-connect/subscribe") {
      await this.handleRuntimeSubscription(req, res);
      return;
    }

    writeJson(
      req,
      res,
      404,
      { error: "Not found" },
      this.config.allowedOrigins
    );
  }

  private authorize(
    req: IncomingMessage
  ): { ok: true } | { ok: false; status: number; message: string } {
    const providedToken =
      bearerToken(req.headers.authorization) ??
      headerValue(req.headers[REMOTE_TOKEN_HEADER]);
    if (
      !(
        providedToken &&
        timingSafeStringEqual(providedToken, this.config.accessToken)
      )
    ) {
      return {
        ok: false,
        status: 401,
        message: "Remote Connect token is required.",
      };
    }

    const access = this.config.cloudflareAccess;
    if (!access) {
      return { ok: true };
    }

    const providedClientId = headerValue(
      req.headers[CF_ACCESS_CLIENT_ID_HEADER]
    );
    const providedClientSecret = headerValue(
      req.headers[CF_ACCESS_CLIENT_SECRET_HEADER]
    );
    if (
      !(
        providedClientId &&
        providedClientSecret &&
        timingSafeStringEqual(providedClientId, access.clientId) &&
        timingSafeStringEqual(providedClientSecret, access.clientSecret)
      )
    ) {
      return {
        ok: false,
        status: 401,
        message: "Cloudflare Access service-token headers are required.",
      };
    }

    return { ok: true };
  }

  private async handleRuntimeRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const payload = await readJsonBody(req, this.config.bodyLimitBytes);
    const operation = parseRuntimeOperation(payload);
    if (!operation) {
      writeJson(
        req,
        res,
        400,
        { error: "Runtime operation is invalid." },
        this.config.allowedOrigins
      );
      return;
    }

    // Remote callers never receive the desktop local token. Electron main is
    // the trusted boundary that converts remote bridge auth into local IPC auth.
    const response = await this.runtime.requestOperation({
      auth: this.trustedRuntimeAuth,
      operation,
    });
    writeJson(req, res, 200, response, this.config.allowedOrigins);
  }

  private async handleRuntimeSubscription(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const payload = await readJsonBody(req, this.config.bodyLimitBytes);
    const operation = parseRuntimeOperation(payload);
    if (!operation || operation.type !== "subscription") {
      writeJson(
        req,
        res,
        400,
        { error: "Runtime subscription operation is invalid." },
        this.config.allowedOrigins
      );
      return;
    }

    applyCorsHeaders(req, res, this.config.allowedOrigins);
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let subscriptionId = "";
    let closed = false;
    const closeSubscription = async () => {
      if (closed) {
        return;
      }
      closed = true;
      if (subscriptionId) {
        await this.runtime
          .unsubscribeOperation(subscriptionId)
          .catch((error) => {
            this.bridgeMessages.push(
              `Remote subscription cleanup failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
      }
      res.end();
    };

    req.on("close", () => {
      closeSubscription().catch((error) => {
        this.bridgeMessages.push(
          `Remote subscription close failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    });

    try {
      const result = await this.runtime.subscribeOperation({
        auth: this.trustedRuntimeAuth,
        operation,
        onEvent: (event) => {
          if (closed) {
            return;
          }
          res.write(`${JSON.stringify({ kind: "event", event })}\n`);
          if (event.type === "complete" || event.type === "error") {
            closeSubscription().catch((error) => {
              this.bridgeMessages.push(
                `Remote subscription completion cleanup failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            });
          }
        },
      });
      subscriptionId = result.subscriptionId;
      res.write(`${JSON.stringify({ kind: "subscribed", subscriptionId })}\n`);
    } catch (error) {
      res.write(
        `${JSON.stringify({
          kind: "event",
          event: {
            type: "error",
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          },
        })}\n`
      );
      await closeSubscription();
    }
  }

  private boundPort(): number | undefined {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      return undefined;
    }
    return (address as AddressInfo).port;
  }

  private localUrl(): string {
    return `http://${this.config.host}:${this.boundPort() ?? this.config.port}`;
  }
}

class CloudflaredTunnelProcess {
  private readonly config: RemoteConnectTunnelConfig;
  private readonly now: () => Date;
  private process: ChildProcess | null = null;
  private tunnelStatus: DesktopRemoteConnectTunnelStatus;
  private readonly tunnelMessages: string[] = [];

  constructor(config: RemoteConnectTunnelConfig, now: () => Date) {
    this.config = config;
    this.now = now;
    this.tunnelStatus = {
      mode: config.mode,
      state: config.mode === "off" ? "disabled" : "stopped",
      ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
    };
  }

  start(serviceUrl: string): void {
    if (this.config.mode === "off" || this.process) {
      return;
    }

    const args = buildCloudflaredArgs(this.config, serviceUrl);
    this.tunnelStatus = {
      ...this.tunnelStatus,
      state: "starting",
      startedAt: this.now().toISOString(),
      stoppedAt: undefined,
      error: undefined,
    };

    this.process = spawn(this.config.executablePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.tunnelStatus = {
      ...this.tunnelStatus,
      pid: this.process.pid,
      state: "ready",
    };

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const url = parseTryCloudflareUrl(text);
      if (url) {
        this.tunnelStatus = {
          ...this.tunnelStatus,
          publicUrl: url,
        };
      }
    };

    this.process.stdout?.on("data", handleOutput);
    this.process.stderr?.on("data", handleOutput);
    this.process.on("error", (error) => {
      this.tunnelStatus = {
        ...this.tunnelStatus,
        state: "error",
        error: error.message,
      };
      this.tunnelMessages.push(`cloudflared failed: ${error.message}`);
    });
    this.process.on("exit", (code, signal) => {
      const wasStopping = this.tunnelStatus.state === "stopping";
      this.process = null;
      this.tunnelStatus = {
        ...this.tunnelStatus,
        state: wasStopping || code === 0 ? "stopped" : "error",
        stoppedAt: this.now().toISOString(),
        pid: undefined,
        ...(wasStopping || code === 0
          ? { error: undefined }
          : {
              error: `cloudflared exited with ${signal ?? code ?? "unknown"}`,
            }),
      };
    });
  }

  stop(): void {
    if (!this.process) {
      this.tunnelStatus = {
        ...this.tunnelStatus,
        state: this.config.mode === "off" ? "disabled" : "stopped",
        stoppedAt: this.now().toISOString(),
      };
      return;
    }

    this.tunnelStatus = { ...this.tunnelStatus, state: "stopping" };
    const child = this.process;
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  }

  status(): DesktopRemoteConnectTunnelStatus {
    return { ...this.tunnelStatus };
  }

  messages(): string[] {
    return [...this.tunnelMessages];
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0)?.trim() ?? null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function bearerToken(value: string | string[] | undefined): string | null {
  const header = headerValue(value);
  if (!header) {
    return null;
  }
  const match = BEARER_TOKEN_PATTERN.exec(header);
  return match?.[1]?.trim() ?? null;
}

function requestPathname(req: IncomingMessage): string {
  const host = req.headers.host ?? "127.0.0.1";
  return new URL(req.url ?? "/", `http://${host}`).pathname;
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseRuntimeOperation(value: unknown): RuntimeServiceOperation | null {
  const candidate =
    value && typeof value === "object" && "operation" in value
      ? (value as { operation?: unknown }).operation
      : value;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const operation = candidate as Partial<RuntimeServiceOperation>;
  if (
    typeof operation.id !== "number" ||
    !["query", "mutation", "subscription"].includes(String(operation.type)) ||
    typeof operation.path !== "string" ||
    operation.path.trim().length === 0
  ) {
    return null;
  }
  return {
    id: operation.id,
    type: operation.type as RuntimeServiceOperation["type"],
    path: operation.path,
    ...(operation.input !== undefined ? { input: operation.input } : {}),
  };
}

function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string[]
): void {
  const origin = headerValue(req.headers.origin);
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "content-type",
      "authorization",
      REMOTE_TOKEN_HEADER,
      CF_ACCESS_CLIENT_ID_HEADER,
      CF_ACCESS_CLIENT_SECRET_HEADER,
    ].join(", ")
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function writeEmptyOptions(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: string[]
): void {
  applyCorsHeaders(req, res, allowedOrigins);
  res.writeHead(204);
  res.end();
}

function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  allowedOrigins: string[]
): void {
  applyCorsHeaders(req, res, allowedOrigins);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
