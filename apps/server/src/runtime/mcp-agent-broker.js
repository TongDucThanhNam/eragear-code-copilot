import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_MCP_FILE = "mcp-servers.json";
const MCP_AGENT_AUDIT_FILE = "mcp-agent-audit.jsonl";
const MAX_AUDIT_TEXT = 2000;
const MCP_PROTOCOL_TIMEOUT_MS = 3500;
const MCP_SSE_RECONNECT_ATTEMPTS = 1;
const DEFAULT_MCP_NOTIFICATION_WATCH_MS = 1000;
const MIN_MCP_REMOTE_REQUEST_TIMEOUT_MS = 1000;
const MAX_MCP_REMOTE_REQUEST_TIMEOUT_MS = 15000;
const MIN_MCP_REMOTE_RECONNECT_ATTEMPTS = 0;
const MAX_MCP_REMOTE_RECONNECT_ATTEMPTS = 3;
const MIN_MCP_NOTIFICATION_WATCH_MS = 250;
const MAX_MCP_NOTIFICATION_WATCH_MS = 5000;
const SECRET_HINT_PATTERN =
  /(api[_-]?key|secret|token|password|private[_-]?key|authorization|cookie)/i;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && typeof value === "string") {
      result[key.slice(2)] = value;
      index += 1;
    }
  }
  return result;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashSecretMaterial(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortedRecordHashes(record) {
  return Object.entries(record ?? {})
    .map(([key, value]) => ({
      key,
      valueHash: hashSecretMaterial(String(value)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function sortedHeaderEnv(record) {
  return Object.entries(record ?? {})
    .map(([header, envKey]) => ({ header, envKey }))
    .sort((left, right) => left.header.localeCompare(right.header));
}

function clampMcpInteger(value, fallback, min, max) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeMcpNotificationWatchMs(value) {
  return clampMcpInteger(
    value,
    DEFAULT_MCP_NOTIFICATION_WATCH_MS,
    MIN_MCP_NOTIFICATION_WATCH_MS,
    MAX_MCP_NOTIFICATION_WATCH_MS
  );
}

function normalizeRemoteControls(value) {
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

function visibleRemoteControls(server) {
  const controls = normalizeRemoteControls(server.remoteControls);
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

function requestTimeoutMs(server) {
  return visibleRemoteControls(server).requestTimeoutMs;
}

function fingerprint(server) {
  const payload = JSON.stringify({
    version: 1,
    transport: server.transport,
    command: server.command?.trim() ?? "",
    args: (server.args ?? []).map((arg) => String(arg)),
    url: server.url?.trim() ?? "",
    messageEndpoint: server.messageEndpoint?.trim() ?? "",
    env: sortedRecordHashes(server.env),
    headers: sortedRecordHashes(server.headers),
    headerEnv: sortedHeaderEnv(server.headerEnv),
    remoteControls: visibleRemoteControls(server),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function normalizeServer(value) {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  const args = Array.isArray(value.args)
    ? value.args.filter((arg) => typeof arg === "string")
    : [];
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    transport:
      value.transport === "sse" || value.transport === "streamable-http"
        ? value.transport
        : "stdio",
    enabled: value.enabled === true,
    command: typeof value.command === "string" ? value.command : "",
    args,
    env: isRecord(value.env) ? value.env : {},
    url: typeof value.url === "string" ? value.url : "",
    messageEndpoint:
      typeof value.messageEndpoint === "string" ? value.messageEndpoint : "",
    headers: isRecord(value.headers) ? value.headers : {},
    headerEnv: isRecord(value.headerEnv) ? value.headerEnv : {},
    remoteControls: normalizeRemoteControls(value.remoteControls),
    trustedFingerprint:
      typeof value.trustedFingerprint === "string"
        ? value.trustedFingerprint
        : "",
  };
}

async function loadServer(projectRoot, serverId) {
  const text = await readFile(
    path.join(projectRoot, ".eragear", PROJECT_MCP_FILE),
    "utf8"
  );
  const parsed = JSON.parse(text);
  const server = Array.isArray(parsed?.servers)
    ? parsed.servers.map(normalizeServer).find((item) => item?.id === serverId)
    : null;
  if (!server) {
    throw new Error(`MCP broker server not found: ${serverId}`);
  }
  return server;
}

function unsafeLiteralHeaderNames(server) {
  return Object.keys(server.headers ?? {}).filter((header) =>
    SECRET_HINT_PATTERN.test(header)
  );
}

function resolveRuntimeHeaders(server) {
  const headers = { ...(server.headers ?? {}) };
  const missingEnvKeys = [];
  const secretValues = [
    ...Object.values(server.env ?? {}).map((value) => String(value)),
    ...Object.values(server.headers ?? {}).map((value) => String(value)),
  ];
  for (const [header, envKey] of Object.entries(server.headerEnv ?? {})) {
    const value = process.env[String(envKey)];
    if (!value) {
      missingEnvKeys.push(String(envKey));
      continue;
    }
    headers[header] = value;
    secretValues.push(value);
  }
  return {
    headers,
    missingEnvKeys,
    blockedLiteralHeaders: unsafeLiteralHeaderNames(server),
    secretValues,
  };
}

function validateServer(server, expectedFingerprint) {
  if (!server.enabled) {
    return "MCP broker blocked disabled server.";
  }
  if (server.transport === "stdio" && !server.command.trim()) {
    return "MCP broker blocked missing stdio command.";
  }
  if (server.transport !== "stdio" && !server.url.trim()) {
    return "MCP broker blocked missing remote MCP URL.";
  }
  const headerPolicy = resolveRuntimeHeaders(server);
  if (headerPolicy.blockedLiteralHeaders.length > 0) {
    return `MCP broker blocked literal secret-looking headers: ${headerPolicy.blockedLiteralHeaders.join(", ")}.`;
  }
  if (headerPolicy.missingEnvKeys.length > 0) {
    return `MCP broker blocked missing header env keys: ${headerPolicy.missingEnvKeys.join(", ")}.`;
  }
  const currentFingerprint = fingerprint(server);
  if (currentFingerprint !== expectedFingerprint) {
    return "MCP broker blocked changed server fingerprint.";
  }
  if (server.trustedFingerprint !== currentFingerprint) {
    return "MCP broker blocked untrusted server fingerprint.";
  }
  return null;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
    },
  });
}

function targetFor(message) {
  if (message.method === "tools/call") {
    return typeof message.params?.name === "string"
      ? message.params.name
      : "unknown-tool";
  }
  if (message.method === "resources/read") {
    return typeof message.params?.uri === "string"
      ? message.params.uri
      : "unknown-resource";
  }
  return message.method ?? "unknown";
}

function collectSecretValues(server) {
  return [
    ...Object.values(server.env ?? {}),
    ...Object.values(server.headers ?? {}),
    ...Object.values(server.headerEnv ?? {})
      .map((envKey) => process.env[String(envKey)])
      .filter(Boolean),
  ]
    .map((value) => String(value))
    .filter(Boolean);
}

function redact(text, secrets) {
  let value = String(text ?? "");
  for (const secret of secrets) {
    if (secret) {
      value = value.split(secret).join("[redacted]");
    }
  }
  return value
    .replace(
      /(api[_-]?key|secret|token|password|authorization|cookie)\s*[:=]\s*["']?[^"',\s}]+/gi,
      "$1=[redacted]"
    )
    .slice(0, MAX_AUDIT_TEXT);
}

function resultText(message, secrets) {
  if (message.error) {
    return redact(message.error.message ?? JSON.stringify(message.error), secrets);
  }
  const result = message.result;
  if (Array.isArray(result?.content)) {
    return result.content
      .map((item) => item?.text ?? JSON.stringify(item))
      .join("\n")
      .slice(0, MAX_AUDIT_TEXT);
  }
  if (Array.isArray(result?.contents)) {
    return result.contents
      .map((item) => item?.text ?? item?.uri ?? JSON.stringify(item))
      .join("\n")
      .slice(0, MAX_AUDIT_TEXT);
  }
  return redact(JSON.stringify(result ?? {}), secrets);
}

async function appendAudit(projectRoot, entry) {
  const filePath = path.join(projectRoot, ".eragear", MCP_AGENT_AUDIT_FILE);
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8").catch(
    () => undefined
  );
}

function parseJsonRpcError(error) {
  if (!isRecord(error)) {
    return "Unknown JSON-RPC error.";
  }
  const code = typeof error.code === "number" ? error.code : "unknown";
  const message =
    typeof error.message === "string" ? error.message : "Unknown error";
  const data = error.data === undefined ? "" : ` data=${JSON.stringify(error.data)}`;
  return `JSON-RPC error ${code}: ${message}${data}`;
}

function normalizeJsonRpcMessages(message) {
  return Array.isArray(message) ? message : [message];
}

function parseMcpHttpMessage(text, contentType) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (contentType.includes("text/event-stream")) {
    const dataLine = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error("SSE response did not contain a data event.");
    }
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(trimmed);
}

function redactJsonValue(value, secrets) {
  const serialized = redact(JSON.stringify(value ?? {}), secrets);
  try {
    return JSON.parse(serialized);
  } catch {
    return {
      jsonrpc: "2.0",
      error: { code: -32000, message: serialized },
    };
  }
}

function parseSseFrames(input) {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split(/\n\n/);
  return {
    frames: parts.slice(0, -1),
    remainder: parts.at(-1) ?? "",
  };
}

function parseSseFrame(frame) {
  let event = "message";
  const data = [];
  for (const rawLine of frame.split(/\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join("\n") };
}

function resolveMcpEndpoint(baseUrl, endpoint) {
  return new URL(endpoint, baseUrl).toString();
}

async function fetchWithTimeout(url, options, timeoutMs = MCP_PROTOCOL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for MCP response.`);
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function mcpHttpExchange(server, body, sessionId, secrets) {
  const headerPolicy = resolveRuntimeHeaders(server);
  const response = await fetchWithTimeout(server.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headerPolicy.headers,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  }, requestTimeoutMs(server));
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const nextSessionId = response.headers.get("mcp-session-id") ?? sessionId;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${redact(text, secrets)}`);
  }
  if (!text.trim()) {
    return { messages: [], sessionId: nextSessionId };
  }
  return {
    messages: normalizeJsonRpcMessages(parseMcpHttpMessage(text, contentType)),
    sessionId: nextSessionId,
  };
}

function createSseBridge() {
  return {
    streamUrl: "",
    endpointUrl: "",
    endpointSettled: false,
    endpointPromise: null,
    resolveEndpoint: () => undefined,
    rejectEndpoint: () => undefined,
    streamController: null,
    streamReader: null,
    readLoop: null,
    pending: new Map(),
    buffer: "",
    closed: false,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args["project-root"];
  const serverId = args["server-id"];
  const expectedFingerprint = args.fingerprint;
  if (!projectRoot || !serverId || !expectedFingerprint) {
    throw new Error("MCP broker requires project-root, server-id, and fingerprint.");
  }

  let server;
  let startupError = null;
  try {
    server = await loadServer(projectRoot, serverId);
    startupError = validateServer(server, expectedFingerprint);
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
  }

  let secrets = server ? collectSecretValues(server) : [];
  const pending = new Map();
  let child = null;
  let httpSessionId = undefined;
  const sseBridge = createSseBridge();
  if (!startupError && server?.transport === "stdio") {
    child = spawn(server.command, server.args ?? [], {
      cwd: projectRoot,
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stderr.on("data", (chunk) => {
      const text = redact(chunk.toString(), secrets);
      if (text) {
        process.stderr.write(`[mcp-agent-broker] ${text}\n`);
      }
    });
    child.on("exit", (code, signal) => {
      const message = signal
        ? `MCP broker target exited with signal ${signal}.`
        : `MCP broker target exited with code ${code ?? 0}.`;
      for (const [id, request] of pending) {
        rpcError(id, message);
        void appendAudit(projectRoot, {
          id: randomUUID(),
          serverId,
          serverName: server.name,
          method: request.method,
          target: request.target,
          status: "failed",
          startedAt: request.startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - request.startedMs,
          error: message,
          source: "agent-broker",
        });
      }
      pending.clear();
    });
  }

  function shutdown() {
    child?.stdin?.end();
    if (child && !child.killed) {
      child.kill();
    }
    sseBridge.closed = true;
    sseBridge.streamController?.abort();
    sseBridge.streamReader?.cancel().catch(() => undefined);
  }

  process.once("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  let childBuffer = "";
  child?.stdout.on("data", async (chunk) => {
    childBuffer += chunk.toString();
    const lines = childBuffer.split(/\r?\n/);
    childBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let message;
      const forwardedLine = redact(line, secrets);
      try {
        message = JSON.parse(forwardedLine);
      } catch {
        process.stdout.write(`${forwardedLine}\n`);
        continue;
      }
      const pendingRequest = pending.get(String(message.id));
      if (!pendingRequest) {
        process.stdout.write(`${forwardedLine}\n`);
        continue;
      }
      pending.delete(String(message.id));
      await appendAudit(projectRoot, {
        id: randomUUID(),
        serverId,
        serverName: server.name,
        method: pendingRequest.method,
        target: pendingRequest.target,
        status: message.error ? "failed" : "success",
        startedAt: pendingRequest.startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - pendingRequest.startedMs,
        resultText: redact(resultText(message, secrets), secrets),
        error: message.error
          ? redact(message.error.message ?? "JSON-RPC error", secrets)
          : undefined,
        source: "agent-broker",
      });
      process.stdout.write(`${forwardedLine}\n`);
    }
  });

  function rejectSsePending(message) {
    for (const [id, waiter] of sseBridge.pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      sseBridge.pending.delete(id);
    }
  }

  function resetSseStream() {
    sseBridge.streamController?.abort();
    sseBridge.streamReader?.cancel().catch(() => undefined);
    sseBridge.streamController = null;
    sseBridge.streamReader = null;
    sseBridge.readLoop = null;
    sseBridge.endpointPromise = null;
    sseBridge.resolveEndpoint = () => undefined;
    sseBridge.rejectEndpoint = () => undefined;
    sseBridge.endpointSettled = false;
    sseBridge.endpointUrl = "";
    sseBridge.buffer = "";
  }

  function settleSseMessage(message, secretsForMessage) {
    for (const item of normalizeJsonRpcMessages(message)) {
      if (!isRecord(item)) {
        continue;
      }
      if (item.id === undefined) {
        send(redactJsonValue(item, secretsForMessage));
        continue;
      }
      const id = String(item.id);
      const waiter = sseBridge.pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      sseBridge.pending.delete(id);
      waiter.resolve(item);
    }
  }

  async function ensureSseStream(currentServer, secretsForMessage) {
    if (
      sseBridge.streamReader &&
      sseBridge.streamUrl === currentServer.url &&
      !sseBridge.closed
    ) {
      return;
    }
    resetSseStream();
    sseBridge.closed = false;
    sseBridge.streamUrl = currentServer.url;
    if (currentServer.messageEndpoint?.trim()) {
      sseBridge.endpointUrl = resolveMcpEndpoint(
        currentServer.url,
        currentServer.messageEndpoint.trim()
      );
      sseBridge.endpointSettled = true;
    }
    if (!sseBridge.endpointSettled) {
      sseBridge.endpointPromise = new Promise((resolve, reject) => {
        sseBridge.resolveEndpoint = (value) => {
          if (!sseBridge.endpointSettled) {
            sseBridge.endpointSettled = true;
            sseBridge.endpointUrl = value;
            resolve(value);
          }
        };
        sseBridge.rejectEndpoint = (error) => {
          if (!sseBridge.endpointSettled) {
            sseBridge.endpointSettled = true;
            reject(error);
          }
        };
      });
    }
    const headerPolicy = resolveRuntimeHeaders(currentServer);
    const controller = new AbortController();
    sseBridge.streamController = controller;
    const headerTimeoutMs = requestTimeoutMs(currentServer);
    const headerTimeout = setTimeout(() => controller.abort(), headerTimeoutMs);
    let response;
    try {
      response = await fetch(currentServer.url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          ...headerPolicy.headers,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Timed out after ${headerTimeoutMs}ms waiting for SSE stream response.`
        );
      }
      throw error;
    } finally {
      clearTimeout(headerTimeout);
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${redact(await response.text(), secretsForMessage)}`
      );
    }
    if (!response.body) {
      throw new Error("SSE response did not include a readable body.");
    }
    const reader = response.body.getReader();
    sseBridge.streamReader = reader;
    const decoder = new TextDecoder();
    sseBridge.readLoop = (async () => {
      try {
        while (!sseBridge.closed) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          sseBridge.buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseSseFrames(sseBridge.buffer);
          sseBridge.buffer = parsed.remainder;
          for (const frame of parsed.frames) {
            const event = parseSseFrame(frame);
            if (!event) {
              continue;
            }
            if (event.event === "endpoint") {
              try {
                sseBridge.resolveEndpoint(
                  resolveMcpEndpoint(currentServer.url, event.data.trim())
                );
              } catch (error) {
                sseBridge.rejectEndpoint(error);
              }
              continue;
            }
            settleSseMessage(JSON.parse(event.data), secretsForMessage);
          }
        }
      } catch (error) {
        if (!sseBridge.closed) {
          rejectSsePending(error instanceof Error ? error.message : String(error));
          sseBridge.rejectEndpoint(error);
        }
      } finally {
        if (!sseBridge.closed) {
          rejectSsePending("MCP SSE stream closed.");
          resetSseStream();
        }
      }
    })();
  }

  async function postSseMessage(currentServer, message, secretsForMessage) {
    await ensureSseStream(currentServer, secretsForMessage);
    const timeoutMs = requestTimeoutMs(currentServer);
    const endpoint =
      sseBridge.endpointUrl ||
      (await Promise.race([
        sseBridge.endpointPromise,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Timed out after ${timeoutMs}ms waiting for SSE endpoint event.`
                )
              ),
            timeoutMs
          )
        ),
      ]));
    const headerPolicy = resolveRuntimeHeaders(currentServer);
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream, */*",
        "content-type": "application/json",
        ...headerPolicy.headers,
      },
      body: JSON.stringify(message),
    }, timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${redact(text, secretsForMessage)}`);
    }
    if (text.trim()) {
      settleSseMessage(
        parseMcpHttpMessage(text, response.headers.get("content-type") ?? ""),
        secretsForMessage
      );
    }
  }

  async function auditRemoteResult(params) {
    await appendAudit(projectRoot, {
      id: randomUUID(),
      serverId,
      serverName: params.server.name,
      method: params.method,
      target: params.target,
      status: params.responseMessage?.error ? "failed" : params.status,
      startedAt: params.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - params.startedMs,
      ...(params.responseMessage
        ? { resultText: redact(resultText(params.responseMessage, secrets), secrets) }
        : {}),
      ...(params.error ? { error: redact(params.error, secrets) } : {}),
      source: "agent-broker",
    });
  }

  async function forwardRemoteMessage(currentServer, message, shouldAudit) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const method = message.method;
    const target = targetFor(message);
    const id = message.id;
    try {
      let responseMessage;
      if (currentServer.transport === "streamable-http") {
        const exchange = await mcpHttpExchange(
          currentServer,
          message,
          httpSessionId,
          secrets
        );
        httpSessionId = exchange.sessionId;
        for (const notification of exchange.messages.filter(
          (item) => isRecord(item) && item.id === undefined
        )) {
          send(redactJsonValue(notification, secrets));
        }
        responseMessage = exchange.messages.find(
          (item) =>
            isRecord(item) &&
            item.id !== undefined &&
            id !== undefined &&
            String(item.id) === String(id)
        );
      } else {
        if (id === undefined) {
          await postSseMessage(currentServer, message, secrets);
          return;
        }
        responseMessage = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            sseBridge.pending.delete(String(id));
            reject(
              new Error(
                `Timed out after ${requestTimeoutMs(currentServer)}ms waiting for ${method}.`
              )
            );
          }, requestTimeoutMs(currentServer));
          sseBridge.pending.set(String(id), {
            method,
            resolve,
            reject,
            timeout,
          });
          postSseMessage(currentServer, message, secrets).catch((error) => {
            clearTimeout(timeout);
            sseBridge.pending.delete(String(id));
            reject(error);
          });
        });
      }

      if (id === undefined) {
        return;
      }
      if (!responseMessage) {
        responseMessage = { jsonrpc: "2.0", id, result: undefined };
      }
      if (shouldAudit) {
        await auditRemoteResult({
          server: currentServer,
          method,
          target,
          startedAt,
          startedMs,
          status: "success",
          responseMessage,
        });
      }
      send(redactJsonValue(responseMessage, secrets));
    } catch (error) {
      const messageText = redact(
        error instanceof Error ? error.message : String(error),
        secrets
      );
      if (id !== undefined) {
        rpcError(id, messageText);
      }
      if (shouldAudit) {
        await auditRemoteResult({
          server: currentServer,
          method,
          target,
          startedAt,
          startedMs,
          status: "failed",
          error: messageText,
        });
      }
    }
  }

  process.stdin.setEncoding("utf8");
  let inputBuffer = "";
  process.stdin.on("data", async (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const method = message.method;
      const shouldAudit =
        method === "tools/call" || method === "resources/read";
      if (
        startupError ||
        !server ||
        (server.transport === "stdio" && !child?.stdin?.writable)
      ) {
        const error = startupError ?? "MCP broker target is not writable.";
        if (message.id !== undefined) {
          rpcError(message.id, error);
        }
        if (shouldAudit) {
          await appendAudit(projectRoot, {
            id: randomUUID(),
            serverId,
            serverName: server?.name ?? serverId,
            method,
            target: targetFor(message),
            status: "failed",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 0,
            error: redact(error, secrets),
            source: "agent-broker",
          });
        }
        continue;
      }
      let policyError = null;
      let currentServer = server;
      try {
        currentServer = await loadServer(projectRoot, serverId);
        policyError = validateServer(currentServer, expectedFingerprint);
        if (!policyError) {
          secrets = collectSecretValues(currentServer);
        }
      } catch (error) {
        policyError = error instanceof Error ? error.message : String(error);
      }
      if (policyError) {
        if (message.id !== undefined) {
          rpcError(message.id, policyError);
        }
        if (shouldAudit) {
          await appendAudit(projectRoot, {
            id: randomUUID(),
            serverId,
            serverName: server.name,
            method,
            target: targetFor(message),
            status: "failed",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 0,
            error: redact(policyError, secrets),
            source: "agent-broker",
          });
        }
        continue;
      }
      if (currentServer.transport !== "stdio") {
        await forwardRemoteMessage(currentServer, message, shouldAudit);
        continue;
      }
      if (shouldAudit && message.id !== undefined) {
        pending.set(String(message.id), {
          method,
          target: targetFor(message),
          startedAt: new Date().toISOString(),
          startedMs: Date.now(),
        });
      }
      child.stdin.write(`${line}\n`);
    }
  });

  process.stdin.on("end", () => {
    shutdown();
  });
}

main().catch((error) => {
  process.stderr.write(
    `[mcp-agent-broker] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
