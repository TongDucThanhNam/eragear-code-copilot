import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LocalAdeService } from "./local-ade.service";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
  StoredSession,
} from "@/modules/session";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { AgentConfig } from "@/shared/types/agent.types";
import type { LogEntry, LogQuery } from "@/shared/types/log.types";
import type { Project } from "@/shared/types/project.types";
import type { AppConfig, Settings } from "@/shared/types/settings.types";
import { matchesLogQuery } from "@/shared/utils/log-query.util";
import type { AppConfigService } from "../app-config.service";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

const userId = "local-test-user";
let tempRoot = "";
const execFileAsync = promisify(execFile);
type RuntimeSession = ReturnType<SessionRuntimePort["getAll"]>[number];
type TestCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | TestCanonicalJsonValue[]
  | { [key: string]: TestCanonicalJsonValue | undefined };

interface CreateServiceOptions {
  activeSessions?: RuntimeSession[];
  storedSessions?: Record<string, StoredSession>;
  logEntries?: LogEntry[];
  defaultModel?: string;
  backgroundRunnerState?: BackgroundRunnerState | null;
}

interface MockEmbeddingServerContext {
  calls: string[][];
  url: string;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "eragear-local-ade-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function canonicalTestJson(value: TestCanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalTestJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter((entry): entry is [string, TestCanonicalJsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalTestJson(entryValue)}`)
    .join(",")}}`;
}

function mockEmbeddingVector(text: string): number[] {
  const lower = text.toLowerCase();
  const includesAny = (tokens: string[]) =>
    tokens.some((token) => lower.includes(token));
  return [
    includesAny(["checkpoint", "restore", "rollback", "safety", "snapshot", "recovery"])
      ? 1
      : 0,
    includesAny(["provider", "auth", "login", "credential"]) ? 1 : 0,
    includesAny(["runtime", "local ade", "session"]) ? 1 : 0,
    includesAny(["plugin", "hook", "extension"]) ? 1 : 0,
    Math.min(1, lower.length / 1000),
  ];
}

async function withMockEmbeddingServer(
  run: (context: MockEmbeddingServerContext) => Promise<void>
): Promise<void> {
  const previousEndpoint = process.env.ERAGEAR_EMBEDDINGS_ENDPOINT;
  const previousModel = process.env.ERAGEAR_EMBEDDINGS_MODEL;
  const previousApiKey = process.env.ERAGEAR_EMBEDDINGS_API_KEY;
  const calls: string[][] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        input?: unknown;
        model?: string;
      };
      const input = Array.isArray(body.input)
        ? body.input.map((item) => String(item))
        : [String(body.input ?? "")];
      calls.push(input);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          model: body.model ?? "mock-embedding",
          data: input.map((text, index) => ({
            object: "embedding",
            index,
            embedding: mockEmbeddingVector(text),
          })),
        })
      );
    })().catch((error) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  process.env.ERAGEAR_EMBEDDINGS_ENDPOINT = `http://127.0.0.1:${address.port}/v1/embeddings`;
  process.env.ERAGEAR_EMBEDDINGS_MODEL = "mock-embedding";
  process.env.ERAGEAR_EMBEDDINGS_API_KEY = "embedding-secret";
  try {
    await run({ calls, url: process.env.ERAGEAR_EMBEDDINGS_ENDPOINT });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEndpoint === undefined) {
      delete process.env.ERAGEAR_EMBEDDINGS_ENDPOINT;
    } else {
      process.env.ERAGEAR_EMBEDDINGS_ENDPOINT = previousEndpoint;
    }
    if (previousModel === undefined) {
      delete process.env.ERAGEAR_EMBEDDINGS_MODEL;
    } else {
      process.env.ERAGEAR_EMBEDDINGS_MODEL = previousModel;
    }
    if (previousApiKey === undefined) {
      delete process.env.ERAGEAR_EMBEDDINGS_API_KEY;
    } else {
      process.env.ERAGEAR_EMBEDDINGS_API_KEY = previousApiKey;
    }
  }
}

function createProject(): Project {
  return {
    id: "project-1",
    userId,
    name: "Test Project",
    path: tempRoot,
    description: null,
    tags: [],
    obsidianProjectPath: null,
    techStackTags: [],
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: null,
  };
}

function createService(
  agents: AgentConfig[] = [],
  options: CreateServiceOptions = {}
): LocalAdeService {
  const project = createProject();
  const projectRepo: ProjectRepositoryPort = {
    findById: async () => project,
    findByPath: async () => project,
    findAll: async () => [project],
    getActiveId: async () => project.id,
    create: async () => project,
    update: async () => project,
    delete: async () => undefined,
    setActive: async () => undefined,
  };
  const agentRepo: AgentRepositoryPort = {
    findById: async () => undefined,
    findAll: async () => agents,
    getActiveId: async () => agents[0]?.id ?? null,
    listByProject: async () => agents,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => undefined,
    setActive: async () => undefined,
    ensureDefaultsSeeded: async () => ({ activeAgentId: null }),
  };
  const sessionRepo = {
    findById: async (id: string) => options.storedSessions?.[id],
    findAll: async () => Object.values(options.storedSessions ?? {}),
    getMessagesPage: async (id: string) => ({
      messages: (options.storedSessions?.[id]?.messages ?? []).slice(-1),
      hasMore: false,
    }),
    countAll: async () => 0,
    getStorageStats: async () => ({
      dbSizeBytes: 0,
      walSizeBytes: 0,
      freePages: 0,
      sessionCount: 0,
      messageCount: 0,
      writeQueueDepth: 0,
    }),
  } as unknown as SessionRepositoryPort;
  const sessionRuntime = {
    getAll: () => options.activeSessions ?? [],
  } as unknown as SessionRuntimePort;
  const queryLogs = (query?: LogQuery) => {
    const entries = [...(options.logEntries ?? [])]
      .filter((entry) => matchesLogQuery(entry, query))
      .sort((left, right) => {
        const timestampDelta = left.timestamp - right.timestamp;
        return timestampDelta === 0 ? left.id.localeCompare(right.id) : timestampDelta;
      });
    if ((query?.order ?? "desc") === "desc") {
      entries.reverse();
    }
    const limited =
      typeof query?.limit === "number" ? entries.slice(0, query.limit) : entries;
    return {
      entries: limited,
      stats: {
        total: entries.length,
        levels: {
          debug: entries.filter((entry) => entry.level === "debug").length,
          info: entries.filter((entry) => entry.level === "info").length,
          warn: entries.filter((entry) => entry.level === "warn").length,
          error: entries.filter((entry) => entry.level === "error").length,
        },
      },
    };
  };
  const logStore: LogStorePort = {
    append: () => undefined,
    list: queryLogs,
    query: async (query) => queryLogs(query),
    subscribe: () => () => undefined,
    flush: async () => undefined,
  };
  const initialAppConfig: AppConfig = {
    sessionIdleTimeoutMs: 300_000,
    sessionListPageMaxLimit: 50,
    sessionMessagesPageMaxLimit: 100,
    logLevel: "info",
    maxTokens: 4096,
    defaultModel: options.defaultModel ?? "",
    acpPromptMetaPolicy: "allowlist",
    acpPromptMetaAllowlist: [],
  };
  let settings: Settings = {
    ui: {
      theme: "system",
      accentColor: "#3b82f6",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: [tempRoot],
    mcpServers: [],
    app: initialAppConfig,
  };
  const settingsRepo: SettingsRepositoryPort = {
    get: async () => settings,
    update: async (patch) => {
      settings = {
        ...settings,
        ...patch,
        app: patch.app ? { ...settings.app, ...patch.app } : settings.app,
      };
      return settings;
    },
  };
  const appConfigService: AppConfigService = {
    getConfig: () => settings.app,
    getDefaults: () => initialAppConfig,
    subscribe: () => () => undefined,
    validatePatch: (patch: Partial<AppConfig>) => ({ ...settings.app, ...patch }),
    applyPatch: (patch: Partial<AppConfig>) => {
      settings = {
        ...settings,
        app: { ...settings.app, ...patch },
      };
      return settings.app;
    },
    reloadFromSettings: (nextSettings: Pick<Settings, "app">) => {
      settings = {
        ...settings,
        app: nextSettings.app,
      };
      return settings.app;
    },
  } as unknown as AppConfigService;
  return new LocalAdeService({
    projectRepo,
    agentRepo,
    sessionRepo,
    sessionRuntime,
    logStore,
    settingsRepo,
    appConfigService,
    getBackgroundRunnerState: () => options.backgroundRunnerState ?? null,
  });
}

async function approvePluginRunOperation(
  service: LocalAdeService,
  pluginId: string
): Promise<string> {
  const snapshot = await service.snapshot(userId);
  const plugin = snapshot.plugins.items.find((item) => item.id === pluginId);
  expect(plugin?.runOperation.fingerprint.startsWith("sha256:")).toBe(true);
  const approved = await service.approvePluginRun(userId, {
    pluginId,
    operationFingerprint: plugin?.runOperation.fingerprint ?? "",
  });
  const approvedPlugin = approved.plugins.items.find((item) => item.id === pluginId);
  expect(approvedPlugin?.runOperation.approvalStatus).toBe("approved");
  expect(approvedPlugin?.runOperation.approvalId).toBeDefined();
  return approvedPlugin?.runOperation.approvalId ?? "";
}

async function approveHookRunOperation(
  service: LocalAdeService,
  hookId: string
): Promise<string> {
  const snapshot = await service.snapshot(userId);
  const hook = snapshot.hooks.items.find((item) => item.id === hookId);
  expect(hook?.runOperation.fingerprint.startsWith("sha256:")).toBe(true);
  const approved = await service.approveHookRun(userId, {
    hookId,
    operationFingerprint: hook?.runOperation.fingerprint ?? "",
  });
  const approvedHook = approved.hooks.items.find((item) => item.id === hookId);
  expect(approvedHook?.runOperation.approvalStatus).toBe("approved");
  expect(approvedHook?.runOperation.approvalId).toBeDefined();
  return approvedHook?.runOperation.approvalId ?? "";
}

async function waitForFile(filePath: string, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function writeMcpFixture(options: {
  toolsError?: boolean;
} = {}): Promise<string> {
  const scriptPath = path.join(tempRoot, "fake-mcp-server.js");
  await writeFile(
    scriptPath,
    `
process.stdin.setEncoding("utf8");
let buffer = "";
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "fake-mcp", version: "1.0.0" },
          capabilities: { tools: {}, resources: {} }
        }
      });
      send({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          data: "initialized secret=" + (process.env.UNIT_MCP_SECRET ?? "")
        }
      });
    } else if (message.method === "tools/list") {
      ${
        options.toolsError
          ? 'send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no tools here" } });'
          : 'send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "read_repo", description: "Read repository files" }] } });'
      }
    } else if (message.method === "resources/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { resources: [{ uri: "file:///README.md", name: "README" }] }
      });
    } else if (message.method === "tools/call") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{
            type: "text",
            text: "tool " + message.params.name + " path=" + (message.params.arguments?.path ?? "") + " secret=" + (process.env.UNIT_MCP_SECRET ?? "")
          }]
        }
      });
      send({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "unit-tool",
          message: "called " + message.params.name + " secret=" + (process.env.UNIT_MCP_SECRET ?? "")
        }
      });
    } else if (message.method === "resources/read") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [{
            uri: message.params.uri,
            mimeType: "text/plain",
            text: "resource " + message.params.uri
          }]
        }
      });
    }
  }
});
`,
    "utf8"
  );
  return scriptPath;
}

async function startSseMcpFixture(options: {
  closeFirstStreamOnFirstRequest?: boolean;
  closeOnceOnMethod?: string;
} = {}): Promise<{
  streamUrl: string;
  messageEndpoint: string;
  requestCounts: Record<string, number>;
  closeNextStreamOnFirstRequest: () => void;
  close: () => Promise<void>;
}> {
  const clients = new Set<ServerResponse>();
  const requestCounts: Record<string, number> = {};
  let firstRequestStreamClosed = false;
  let methodStreamClosed = false;
  let closeNextStreamOnFirstRequest = false;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/sse") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      clients.add(response);
      response.write("event: endpoint\ndata: /messages\n\n");
      request.on("close", () => {
        clients.delete(response);
      });
      return;
    }
    if (request.method === "POST" && request.url === "/messages") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(202).end();
        const message = JSON.parse(body);
        requestCounts[message.method] = (requestCounts[message.method] ?? 0) + 1;
        if (
          options.closeFirstStreamOnFirstRequest &&
          !firstRequestStreamClosed
        ) {
          firstRequestStreamClosed = true;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (closeNextStreamOnFirstRequest) {
          closeNextStreamOnFirstRequest = false;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (
          options.closeOnceOnMethod === message.method &&
          !methodStreamClosed
        ) {
          methodStreamClosed = true;
          for (const client of clients) {
            client.end();
          }
          return;
        }
        if (message.method === "notifications/initialized") {
          return;
        }
        let result: unknown = {};
        if (message.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "fake-sse-mcp", version: "1.1.0" },
            capabilities: { tools: {}, resources: {} },
          };
        } else if (message.method === "tools/list") {
          result = {
            tools: [{ name: "sse_read_repo", description: "Read through SSE" }],
          };
        } else if (message.method === "resources/list") {
          result = {
            resources: [{ uri: "file:///SSE.md", name: "SSE" }],
          };
        } else if (message.method === "tools/call") {
          result = {
            content: [
              {
                type: "text",
                text: `sse tool ${message.params.name} auth=${request.headers.authorization ?? ""}`,
              },
            ],
          };
        } else if (message.method === "resources/read") {
          result = {
            contents: [
              {
                uri: message.params.uri,
                mimeType: "text/plain",
                text: `sse resource ${message.params.uri}`,
              },
            ],
          };
        }
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result,
        });
        const notificationPayload = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "info",
            data: `sse ${message.method} auth=${request.headers.authorization ?? ""}`,
          },
        });
        for (const client of clients) {
          client.write(`event: message\ndata: ${notificationPayload}\n\n`);
          client.write(`event: message\ndata: ${payload}\n\n`);
        }
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    streamUrl: `${baseUrl}/sse`,
    messageEndpoint: `${baseUrl}/messages`,
    requestCounts,
    closeNextStreamOnFirstRequest: () => {
      closeNextStreamOnFirstRequest = true;
    },
    close: async () => {
      for (const client of clients) {
        client.end();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function startHttpMcpFixture(expectedAuthorization: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== expectedAuthorization) {
      response
        .writeHead(401, { "content-type": "text/plain" })
        .end(`missing ${expectedAuthorization}`);
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const message = JSON.parse(body);
      let result: unknown = {};
      if (message.method === "initialize") {
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "fake-http-mcp", version: "1.2.0" },
          capabilities: { tools: {}, resources: {} },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [{ name: "http_read_repo", description: "Read through HTTP" }],
        };
      } else if (message.method === "resources/list") {
        result = {
          resources: [{ uri: "file:///HTTP.md", name: "HTTP" }],
        };
      } else if (message.method === "tools/call") {
        result = {
          content: [
            {
              type: "text",
              text: `http tool ${message.params.name} auth=${request.headers.authorization ?? ""}`,
            },
          ],
        };
      } else if (message.method === "resources/read") {
        result = {
          contents: [
            {
              uri: message.params.uri,
              mimeType: "text/plain",
              text: `http resource ${message.params.uri}`,
            },
          ],
        };
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function writeProviderFixture(): Promise<string> {
  const scriptPath = path.join(tempRoot, "fake-provider-cli.js");
  await writeFile(
    scriptPath,
    `
const args = process.argv.slice(2);
const joined = args.join(" ");
if (joined === "--version") {
  process.stdout.write("fake-provider 1.2.3\\n");
  process.exit(0);
}
if (joined === "auth list" || joined === "auth status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
if (joined === "models" || joined === "models list") {
  process.stdout.write(JSON.stringify({ models: [{ id: "model-alpha" }, { id: "model-beta" }] }));
  process.exit(0);
}
process.stderr.write("unsupported command: " + joined + "\\n");
process.exit(2);
`,
    "utf8"
  );
  return scriptPath;
}

async function writeCodexProviderFixture(): Promise<string> {
  const scriptPath = path.join(tempRoot, "fake-codex-provider-cli.js");
  await writeFile(
    scriptPath,
    `
const args = process.argv.slice(2);
const joined = args.join(" ");
if (joined === "--version") {
  process.stdout.write("codex-cli 9.9.9\\n");
  process.exit(0);
}
if (joined === "doctor --json") {
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    overallStatus: "ok",
    codexVersion: "9.9.9",
    padding: "x".repeat(1200),
    checks: {
      "auth.credentials": {
        status: "ok",
        summary: "auth is configured",
        details: { "stored auth mode": "chatgpt", "stored ChatGPT tokens": "true" }
      },
      "config.load": {
        status: "ok",
        summary: "config loaded",
        details: { model: "gpt-test", "model provider": "openai" }
      },
      "network.provider_reachability": {
        status: "ok",
        summary: "provider reachable"
      }
    }
  }));
  process.exit(0);
}
if (joined === "models" || joined === "models list" || joined === "auth status") {
  process.stderr.write("unsupported codex fallback command: " + joined + "\\n");
  process.exit(2);
}
process.stderr.write("unsupported command: " + joined + " secret=" + (process.env.CODEX_TEST_SECRET ?? "") + "\\n");
process.exit(2);
`,
    "utf8"
  );
  return scriptPath;
}

async function writeClaudeProviderFixture(): Promise<string> {
  const scriptPath = path.join(tempRoot, "fake-claude-provider-cli.js");
  await writeFile(
    scriptPath,
    `
const args = process.argv.slice(2);
const joined = args.join(" ");
if (joined === "--version") {
  process.stdout.write("claude-code 3.2.1\\n");
  process.exit(0);
}
if (joined === "doctor --json") {
  process.stdout.write(JSON.stringify({
    status: "ok",
    auth: { status: "ok", account: "user@example.test" },
    models: [{ name: "claude-sonnet-smoke" }, { modelId: "claude-opus-smoke" }]
  }));
  process.exit(0);
}
process.stderr.write("unsupported claude command: " + joined + " token=" + (process.env.CLAUDE_TEST_SECRET ?? "") + "\\n");
process.exit(2);
`,
    "utf8"
  );
  return scriptPath;
}

async function writeGeminiProviderFixture(): Promise<string> {
  const scriptPath = path.join(tempRoot, "fake-gemini-provider-cli.js");
  await writeFile(
    scriptPath,
    `
const args = process.argv.slice(2);
const joined = args.join(" ");
if (joined === "--version") {
  process.stdout.write("gemini-cli 4.5.6\\n");
  process.exit(0);
}
if (joined === "doctor --json") {
  process.stderr.write("doctor unavailable for fixture\\n");
  process.exit(2);
}
if (joined === "auth status") {
  process.stdout.write("logged in as gemini-user@example.test\\n");
  process.exit(0);
}
if (joined === "models" || joined === "models list") {
  process.stdout.write("gemini-2.5-pro - production model\\ngemini-2.5-flash - fast model\\n");
  process.exit(0);
}
process.stderr.write("unsupported gemini command: " + joined + " key=" + (process.env.GEMINI_TEST_SECRET ?? "") + "\\n");
process.exit(2);
`,
    "utf8"
  );
  return scriptPath;
}

test("discovers project commands and persists disabled state", async () => {
  await mkdir(path.join(tempRoot, ".eragear", "commands"), {
    recursive: true,
  });
  await writeFile(
    path.join(tempRoot, ".eragear", "commands", "fix.md"),
    "---\nname: /fix\ndescription: Fix the current issue\nargument-hint: <file or symptom>\n---\n# Fix\nInspect $ARGUMENTS and propose the smallest patch.\n",
    "utf8"
  );

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const command = snapshot.capabilities.capabilities.find(
    (item) => item.kind === "command" && item.name === "/fix"
  );
  const invokable = snapshot.commands.find((item) => item.name === "/fix");

  expect(command).toBeDefined();
  expect(command?.enabled).toBe(true);
  expect(invokable?.enabled).toBe(true);
  expect(invokable?.argumentHint).toBe("<file or symptom>");
  expect(invokable?.prompt).toContain("Inspect $ARGUMENTS");

  const updated = await service.updateCapabilityState(userId, {
    capabilityId: command?.id ?? "",
    enabled: false,
  });
  const disabled = updated.capabilities.capabilities.find(
    (item) => item.id === command?.id
  );
  const disabledInvokable = updated.commands.find(
    (item) => item.id === command?.id
  );
  const state = JSON.parse(
    await readFile(
      path.join(tempRoot, ".eragear", "capabilities-state.json"),
      "utf8"
    )
  );

  expect(disabled?.enabled).toBe(false);
  expect(disabledInvokable?.enabled).toBe(false);
  expect(state.capabilities[command?.id ?? ""]?.enabled).toBe(false);
});

test("classifies remote auth admin dashboard parity as local N/A policy", async () => {
  const service = createService();
  const snapshot = await service.snapshot(userId);
  const authAdmin = snapshot.dashboardParity.find(
    (item) => item.workflow === "Auth admin and device sessions"
  );

  expect(authAdmin?.status).toBe("not-applicable");
  expect(authAdmin?.policy?.scope).toBe("local-desktop");
  expect(authAdmin?.policy?.decision).toBe("not-applicable");
  expect(authAdmin?.reason).toContain("outside the local desktop ADE surface");
  expect(snapshot.blockers.map((item) => item.workflow)).not.toContain(
    "Auth admin and device sessions"
  );
});

test("exposes background runner task state in local ADE snapshot", async () => {
  const service = createService([], {
    backgroundRunnerState: {
      enabled: true,
      startedAt: 1_781_229_000_000,
      tickMs: 1000,
      tasks: [
        {
          name: "plugin-batch-schedule-dispatch",
          intervalMs: 1000,
          timeoutMs: 30_000,
          running: false,
          lastStartedAt: 1_781_229_001_000,
          lastFinishedAt: 1_781_229_001_125,
          lastDurationMs: 125,
          successCount: 3,
          failureCount: 0,
          lastResult: {
            users: 1,
            projects: 1,
            dueSchedules: 1,
            dispatchedSchedules: 1,
            failedProjects: 0,
          },
        },
      ],
    },
  });

  const snapshot = await service.snapshot(userId);
  const background = snapshot.runtime.background;
  const task = background?.tasks.find(
    (item) => item.name === "plugin-batch-schedule-dispatch"
  );

  expect(background?.enabled).toBe(true);
  expect(background?.tickMs).toBe(1000);
  expect(task?.successCount).toBe(3);
  expect(task?.lastResult?.dispatchedSchedules).toBe(1);
});

test("toggles project memory state separately from generic capabilities", async () => {
  await writeFile(path.join(tempRoot, "AGENTS.md"), "# Agent context\n", "utf8");

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const source = snapshot.projectMemory.sources.find(
    (item) => item.relativePath === "AGENTS.md"
  );

  expect(source).toBeDefined();
  expect(source?.enabled).toBe(true);

  const updated = await service.updateCapabilityState(userId, {
    capabilityId: source?.id ?? "",
    enabled: false,
  });
  const disabled = updated.projectMemory.sources.find(
    (item) => item.id === source?.id
  );
  const state = JSON.parse(
    await readFile(
      path.join(tempRoot, ".eragear", "capabilities-state.json"),
      "utf8"
    )
  );

  expect(disabled?.enabled).toBe(false);
  expect(state.memory[source?.id ?? ""]?.enabled).toBe(false);
});

test("builds bounded redacted project memory context from enabled sources", async () => {
  await mkdir(path.join(tempRoot, ".eragear"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "AGENTS.md"),
    [
      "# Agent context",
      "Prefer Local ADE flows.",
      "api_key=super-secret-value",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, ".eragear", "memory.md"),
    "# Project memory\nUse checkpoint preview before restore.\n",
    "utf8"
  );

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const projectMemory = snapshot.projectMemory.sources.find(
    (source) => source.relativePath === ".eragear/memory.md"
  );

  expect(projectMemory).toBeDefined();

  await service.updateCapabilityState(userId, {
    capabilityId: projectMemory?.id ?? "",
    enabled: false,
  });
  const context = await service.buildProjectMemoryContext(userId, {
    query: "Plan the restore workflow",
  });

  expect(context.status).toBe("ready");
  expect(context.sources.map((source) => source.relativePath)).toEqual([
    "AGENTS.md",
  ]);
  expect(context.prompt).toContain("Prefer Local ADE flows.");
  expect(context.prompt).toContain("Plan the restore workflow");
  expect(context.prompt).toContain("api_key= [redacted]");
  expect(context.prompt).not.toContain("super-secret-value");
  expect(context.prompt).not.toContain("Use checkpoint preview before restore");
  expect(context.diagnostics.join("\n")).toContain(
    "Included 1 enabled project memory source"
  );
});

test("builds project memory context for selected source paths", async () => {
  await mkdir(path.join(tempRoot, ".eragear"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "AGENTS.md"),
    "# Agent context\nUse broad memory.\n",
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, ".eragear", "context.md"),
    "# Project context\nUse selected memory source only.\n",
    "utf8"
  );

  const service = createService();
  const context = await service.buildProjectMemoryContext(userId, {
    query: "Use selected memory",
    sourcePaths: [".eragear/context.md"],
  });

  expect(context.status).toBe("ready");
  expect(context.sources.map((source) => source.relativePath)).toEqual([
    ".eragear/context.md",
  ]);
  expect(context.prompt).toContain("Use selected memory source only.");
  expect(context.prompt).not.toContain("Use broad memory.");
});

test("builds semantic project memory context from ranked chunks", async () => {
  await mkdir(path.join(tempRoot, ".eragear"), { recursive: true });
  await writeFile(
    path.join(tempRoot, ".eragear", "context.md"),
    [
      "# Provider notes",
      "Use provider auth diagnostics when login fails.",
      "",
      "# Runtime workflow",
      "Prefer runtime-backed Local ADE actions before editing.",
      "api_key=semantic-secret",
      "",
    ].join("\n"),
    "utf8"
  );

  const service = createService();
  const context = await service.buildProjectMemoryContext(userId, {
    query: "runtime-backed Local ADE actions",
    sourcePaths: [".eragear/context.md"],
    retrievalMode: "semantic",
    maxChunks: 1,
    maxBytes: 4000,
  });

  expect(context.status).toBe("ready");
  expect(context.retrievalMode).toBe("semantic");
  expect(context.chunks).toHaveLength(1);
  expect(context.sources.map((source) => source.relativePath)).toEqual([
    ".eragear/context.md",
  ]);
  expect(context.chunks[0]?.relativePath).toBe(".eragear/context.md");
  expect(context.chunks[0]?.score).toBeGreaterThan(0);
  expect(context.prompt).toContain(
    "Project memory retrieval mode: local hashed token-vector chunk ranking."
  );
  expect(context.prompt).toContain(
    "Prefer runtime-backed Local ADE actions before editing."
  );
  expect(context.prompt).toContain("api_key= [redacted]");
  expect(context.prompt).not.toContain("semantic-secret");
  expect(context.prompt).not.toContain("Use provider auth diagnostics");
});

test("builds model-backed project memory context when embeddings are configured", async () => {
  await mkdir(path.join(tempRoot, ".eragear"), { recursive: true });
  await writeFile(
    path.join(tempRoot, ".eragear", "context.md"),
    [
      "# Provider notes",
      "Use provider auth diagnostics when login fails.",
      "",
      "# Restore notes",
      "Prefer checkpoint restore safety plans before touching files.",
      "api_key=model-memory-secret",
      "",
    ].join("\n"),
    "utf8"
  );

  await withMockEmbeddingServer(async ({ calls }) => {
    const service = createService();
    const context = await service.buildProjectMemoryContext(userId, {
      query: "rollback safety checkpoint",
      sourcePaths: [".eragear/context.md"],
      retrievalMode: "semantic",
      maxChunks: 1,
      maxBytes: 4000,
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(context.status).toBe("ready");
    expect(context.semantic?.ranker).toBe("model-embedding");
    expect(context.semantic?.model).toBe("mock-embedding");
    expect(context.semantic?.dimensions).toBe(5);
    expect(context.chunks).toHaveLength(1);
    expect(context.chunks[0]?.ranker).toBe("model-embedding");
    expect(context.chunks[0]?.embeddingModel).toBe("mock-embedding");
    expect(context.prompt).toContain(
      "Project memory retrieval mode: model-backed embedding chunk ranking."
    );
    expect(context.prompt).toContain("Prefer checkpoint restore safety plans");
    expect(context.prompt).not.toContain("Use provider auth diagnostics");
    expect(context.prompt).not.toContain("model-memory-secret");
    expect(context.diagnostics.join("\n")).toContain(
      "model-backed embeddings"
    );
    expect(context.diagnostics.join("\n")).not.toContain("embedding-secret");
  });
});

test("saves uses and deletes project memory presets", async () => {
  await mkdir(path.join(tempRoot, ".eragear"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "AGENTS.md"),
    "# Agent context\nUse broad memory.\n",
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, ".eragear", "context.md"),
    [
      "# Broad notes",
      "Use broad memory.",
      "",
      "# Restore notes",
      "Prefer checkpoint-safe restore plans.",
      "",
    ].join("\n"),
    "utf8"
  );

  const service = createService();
  const saved = await service.upsertProjectMemoryPreset(userId, {
    id: "restore-review",
    name: "Restore Review",
    sourcePaths: [".eragear/context.md"],
    defaultQuery: "Review restore risk",
    retrievalMode: "semantic",
    maxBytes: 4000,
    maxChunks: 1,
  });
  const preset = saved.projectMemory.presets.find(
    (item) => item.id === "restore-review"
  );

  expect(preset?.name).toBe("Restore Review");
  expect(preset?.sourcePaths).toEqual([".eragear/context.md"]);
  expect(preset?.retrievalMode).toBe("semantic");
  expect(preset?.maxBytes).toBe(4000);
  expect(preset?.maxChunks).toBe(1);

  const context = await service.buildProjectMemoryContext(userId, {
    presetId: "restore-review",
  });

  expect(context.status).toBe("ready");
  expect(context.presetId).toBe("restore-review");
  expect(context.presetName).toBe("Restore Review");
  expect(context.retrievalMode).toBe("semantic");
  expect(context.query).toBe("Review restore risk");
  expect(context.sources.map((source) => source.relativePath)).toEqual([
    ".eragear/context.md",
  ]);
  expect(context.chunks).toHaveLength(1);
  expect(context.prompt).toContain(
    'Use project memory preset "Restore Review" for: Review restore risk'
  );
  expect(context.prompt).toContain("Prefer checkpoint-safe restore plans.");
  expect(context.prompt).not.toContain("Use broad memory.");

  const deleted = await service.deleteProjectMemoryPreset(userId, {
    id: "restore-review",
  });

  expect(deleted.projectMemory.presets).toEqual([]);
});

test("refreshes project index metadata and skips generated directories", async () => {
  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await mkdir(path.join(tempRoot, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(tempRoot, ".git", "objects"), { recursive: true });
  await mkdir(path.join(tempRoot, ".eragear", "checkpoints"), {
    recursive: true,
  });
  await writeFile(path.join(tempRoot, "README.md"), "# Indexed\nTODO: document plugin flow\n", "utf8");
  await writeFile(
    path.join(tempRoot, "src", "index.ts"),
    [
      "export function runIndexedTask() {",
      "  return true;",
      "}",
      "export class IndexedWorker {}",
      "// Checkpoint restore safety planning handles snapshot recovery.",
      "// FIXME: tighten scan coverage",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, "node_modules", "pkg", "skip.js"),
    "module.exports = {}\n",
    "utf8"
  );
  await writeFile(path.join(tempRoot, ".git", "HEAD"), "ref: main\n", "utf8");
  await writeFile(
    path.join(tempRoot, ".eragear", "checkpoints", "skip.patch"),
    "diff --git\n",
    "utf8"
  );
  const hookScript = path.join(tempRoot, "index-hook.js");
  await writeFile(
    hookScript,
    "process.stdout.write('index lifecycle '+process.env.ERAGEAR_HOOK_EVENT);",
    "utf8"
  );

  const service = createService();
  const emptySearch = await service.searchProjectIndex(userId, {
    query: "runIndexedTask",
  });
  expect(emptySearch.status).toBe("not-indexed");
  expect(emptySearch.prompt).toContain("has not been refreshed");

  const hookSnapshot = await service.upsertHook(userId, {
    id: "index-hook",
    name: "Index Hook",
    event: "after-project-index-refresh",
    command: process.execPath,
    args: [hookScript],
  });
  const indexHook = hookSnapshot.hooks.items.find((item) => item.id === "index-hook");
  expect(indexHook?.trustStatus).toBe("untrusted");
  await service.trustHook(userId, {
    hookId: "index-hook",
    fingerprint: indexHook?.fingerprint ?? "",
  });
  const updated = await service.refreshProjectIndex(userId, {});
  const indexedPaths = updated.projectIndex.files.map((file) => file.path);
  const indexedSymbols = updated.projectIndex.symbols.map((symbol) => symbol.name);
  const indexedTasks = updated.projectIndex.tasks.map((task) => task.marker);
  const lifecycleHook = updated.hooks.items.find((item) => item.id === "index-hook");
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "repo-index.json"), "utf8")
  );
  const storedPaths = stored.files.map((file: { path: string }) => file.path);
  const storedIndexFile = stored.files.find(
    (file: { path: string }) => file.path === "src/index.ts"
  );
  const snapshot = await service.snapshot(userId);

  expect(updated.projectIndex.indexedFiles).toBeGreaterThanOrEqual(2);
  expect(indexedPaths).toContain("README.md");
  expect(indexedPaths).toContain("src/index.ts");
  expect(indexedPaths).not.toContain("node_modules/pkg/skip.js");
  expect(storedPaths).not.toContain(".git/HEAD");
  expect(storedPaths).not.toContain(".eragear/checkpoints/skip.patch");
  expect(updated.projectIndex.extensions).toContainEqual({
    extension: ".ts",
    count: 1,
  });
  expect(updated.projectIndex.diagnostics.join("\n")).toContain(
    "code-symbol signals"
  );
  expect(updated.projectIndex.semantic.status).toBe("ready");
  expect(updated.projectIndex.semantic.profiledFiles).toBeGreaterThan(0);
  expect(storedIndexFile?.semanticTags).toContain("restore");
  expect(storedIndexFile?.semanticTags).toContain("rollback");
  expect(storedIndexFile?.semanticHash).toStartWith("sha256:");
  expect(indexedSymbols).toContain("runIndexedTask");
  expect(indexedSymbols).toContain("IndexedWorker");
  expect(indexedTasks).toContain("TODO");
  expect(indexedTasks).toContain("FIXME");
  expect(stored.symbols.map((symbol: { name: string }) => symbol.name)).toContain(
    "runIndexedTask"
  );
  expect(stored.tasks.map((task: { marker: string }) => task.marker)).toContain(
    "TODO"
  );
  expect(lifecycleHook?.lastRun?.status).toBe("success");
  expect(lifecycleHook?.lastRun?.stdout).toContain(
    "index lifecycle after-project-index-refresh"
  );
  expect(snapshot.projectIndex.indexedFiles).toBe(updated.projectIndex.indexedFiles);

  const search = await service.searchProjectIndex(userId, {
    query: "runIndexedTask",
    limit: 4,
  });
  expect(search.status).toBe("ready");
  expect(search.results.length).toBeGreaterThan(0);
  expect(search.results.some((item) => item.title.includes("runIndexedTask"))).toBe(
    true
  );
  expect(search.prompt).toContain("Matched project index entries");
  expect(search.prompt).toContain("src/index.ts");
  expect(search.prompt).toContain("Before editing, read the referenced files directly.");
  expect(search.prompt).not.toContain("return true");

  const taskSearch = await service.searchProjectIndex(userId, {
    query: "FIXME",
    limit: 4,
  });
  expect(taskSearch.status).toBe("ready");
  expect(taskSearch.results.some((item) => item.title.includes("FIXME"))).toBe(true);
  expect(taskSearch.prompt).toContain("tighten scan coverage");

  const semanticSearch = await service.searchProjectIndex(userId, {
    query: "rollback safety",
    limit: 4,
  });
  const semanticHit = semanticSearch.results.find(
    (item) => item.path === "src/index.ts"
  );
  expect(semanticSearch.status).toBe("ready");
  expect(semanticHit?.matchKind).toBe("semantic");
  expect(semanticHit?.detail).toContain("semantic profile match");
  expect(semanticSearch.prompt).toContain("local semantic token profiles");
  expect(semanticSearch.prompt).not.toContain("snapshot recovery");
});

test("refreshes project index with model-backed embedding vectors", async () => {
  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await mkdir(path.join(tempRoot, "docs"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "src", "restore.ts"),
    [
      "export function planRestoreSafety() {",
      "  return 'checkpoint restore safety planning';",
      "}",
      "// Snapshot recovery should be reviewed before file edits.",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, "docs", "provider.md"),
    "# Provider\nUse provider auth login diagnostics.\n",
    "utf8"
  );

  await withMockEmbeddingServer(async ({ calls }) => {
    const service = createService();
    const snapshot = await service.refreshProjectIndex(userId, {});
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "repo-index.json"), "utf8")
    );
    const storedRestoreFile = stored.files.find(
      (file: { path: string }) => file.path === "src/restore.ts"
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(snapshot.projectIndex.semantic.source).toBe("model-embedding");
    expect(snapshot.projectIndex.semantic.model).toBe("mock-embedding");
    expect(snapshot.projectIndex.semantic.dimensions).toBe(5);
    expect(snapshot.projectIndex.semantic.embeddedFiles).toBeGreaterThan(0);
    expect(Array.isArray(storedRestoreFile?.embeddingVector)).toBe(true);
    expect(storedRestoreFile?.embeddingModel).toBe("mock-embedding");
    expect(storedRestoreFile?.embeddingHash).toStartWith("sha256:");
    expect(snapshot.projectIndex.files[0]).not.toHaveProperty("embeddingVector");

    const search = await service.searchProjectIndex(userId, {
      query: "rollback safety",
      limit: 4,
    });
    const hit = search.results.find((item) => item.path === "src/restore.ts");

    expect(search.status).toBe("ready");
    expect(hit?.matchKind).toBe("embedding");
    expect(hit?.detail).toContain("model embedding match");
    expect(search.prompt).toContain("model-backed embedding vectors");
    expect(search.prompt).not.toContain("Snapshot recovery should be reviewed");
    expect(search.diagnostics.join("\n")).toContain(
      "Compared query embedding"
    );
    expect(search.diagnostics.join("\n")).not.toContain("embedding-secret");
  });
});

test("governs lifecycle hook batches with pause and stop-on-failure policy", async () => {
  await writeFile(path.join(tempRoot, "README.md"), "# Lifecycle Governance\n", "utf8");
  const failScript = path.join(tempRoot, "lifecycle-fail.js");
  const secondScript = path.join(tempRoot, "lifecycle-second.js");
  const secondOutput = path.join(tempRoot, "lifecycle-second-output.txt");
  await writeFile(
    failScript,
    "process.stderr.write('first failed'); process.exit(2);",
    "utf8"
  );
  await writeFile(
    secondScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(secondOutput)}, 'ran');`,
      "process.stdout.write('second ran '+process.env.ERAGEAR_HOOK_EVENT);",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const firstSaved = await service.upsertHook(userId, {
    id: "lifecycle-first",
    name: "Lifecycle First",
    event: "after-project-index-refresh",
    command: process.execPath,
    args: [failScript],
    timeoutMs: 5000,
  });
  const secondSaved = await service.upsertHook(userId, {
    id: "lifecycle-second",
    name: "Lifecycle Second",
    event: "after-project-index-refresh",
    command: process.execPath,
    args: [secondScript],
    timeoutMs: 5000,
  });
  await service.trustHook(userId, {
    hookId: "lifecycle-first",
    fingerprint:
      firstSaved.hooks.items.find((item) => item.id === "lifecycle-first")
        ?.fingerprint ?? "",
  });
  await service.trustHook(userId, {
    hookId: "lifecycle-second",
    fingerprint:
      secondSaved.hooks.items.find((item) => item.id === "lifecycle-second")
        ?.fingerprint ?? "",
  });

  const governed = await service.updateHookLifecyclePolicy(userId, {
    failureMode: "stop-on-failure",
  });
  expect(governed.hooks.lifecyclePolicy.enabled).toBe(true);
  expect(governed.hooks.lifecyclePolicy.failureMode).toBe("stop-on-failure");

  const stopped = await service.refreshProjectIndex(userId, {});
  const failedHook = stopped.hooks.items.find((item) => item.id === "lifecycle-first");
  const skippedHook = stopped.hooks.items.find(
    (item) => item.id === "lifecycle-second"
  );
  expect(failedHook?.lastRun?.status).toBe("failed");
  expect(skippedHook?.lastRun?.status).toBe("disabled");
  expect(failedHook?.lastRun?.batchId?.startsWith("hook-batch-")).toBe(true);
  expect(skippedHook?.lastRun?.batchId).toBe(failedHook?.lastRun?.batchId);
  expect(skippedHook?.lastRun?.diagnostics.join("\n")).toContain(
    "stop-on-failure"
  );
  expect(existsSync(secondOutput)).toBe(false);

  const pausedPolicy = await service.updateHookLifecyclePolicy(userId, {
    disabledEvents: ["after-project-index-refresh"],
    failureMode: "continue",
  });
  expect(pausedPolicy.hooks.lifecyclePolicy.disabledEvents).toEqual([
    "after-project-index-refresh",
  ]);
  const paused = await service.refreshProjectIndex(userId, {});
  const pausedFirst = paused.hooks.items.find((item) => item.id === "lifecycle-first");
  const pausedSecond = paused.hooks.items.find(
    (item) => item.id === "lifecycle-second"
  );
  expect(pausedFirst?.lastRun?.status).toBe("disabled");
  expect(pausedSecond?.lastRun?.status).toBe("disabled");
  expect(pausedFirst?.lastRun?.batchId).not.toBe(failedHook?.lastRun?.batchId);
  expect(pausedSecond?.lastRun?.batchId).toBe(pausedFirst?.lastRun?.batchId);
  expect(pausedFirst?.lastRun?.diagnostics.join("\n")).toContain(
    "event after-project-index-refresh is paused"
  );
  expect(existsSync(secondOutput)).toBe(false);

  await service.updateHookLifecyclePolicy(userId, {
    disabledEvents: [],
    failureMode: "continue",
  });
  await service.toggleHook(userId, { id: "lifecycle-first", enabled: false });
  const resumed = await service.refreshProjectIndex(userId, {});
  const resumedSecond = resumed.hooks.items.find(
    (item) => item.id === "lifecycle-second"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
  );
  expect(resumed.hooks.lifecyclePolicy.disabledEvents).toEqual([]);
  expect(resumedSecond?.lastRun?.status).toBe("success");
  expect(resumedSecond?.lastRun?.batchId?.startsWith("hook-batch-")).toBe(true);
  expect(await readFile(secondOutput, "utf8")).toBe("ran");
  expect(stored.lifecyclePolicy.failureMode).toBe("continue");
});

test("enforces hook scheduling pause and cooldown before spawn", async () => {
  const hookScript = path.join(tempRoot, "scheduled-hook.js");
  const outputPath = path.join(tempRoot, "scheduled-hook-count.txt");
  await writeFile(
    hookScript,
    [
      "const fs = require('node:fs');",
      `const p = ${JSON.stringify(outputPath)};`,
      "const next = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) + 1 : 1;",
      "fs.writeFileSync(p, String(next));",
      "process.stdout.write('scheduled hook ran '+next);",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const saved = await service.upsertHook(userId, {
    id: "scheduled-hook",
    name: "Scheduled Hook",
    command: process.execPath,
    args: [hookScript],
    timeoutMs: 5000,
  });
  await service.trustHook(userId, {
    hookId: "scheduled-hook",
    fingerprint:
      saved.hooks.items.find((item) => item.id === "scheduled-hook")?.fingerprint ??
      "",
  });

  const firstApprovalId = await approveHookRunOperation(service, "scheduled-hook");
  const firstRun = await service.runHook(userId, {
    hookId: "scheduled-hook",
    confirmation: "RUN HOOK scheduled-hook",
    operationApprovalId: firstApprovalId,
  });
  expect(
    firstRun.hooks.items.find((item) => item.id === "scheduled-hook")?.lastRun?.status
  ).toBe("success");
  expect(await readFile(outputPath, "utf8")).toBe("1");

  const cooldownPolicy = await service.updateHookSchedulingPolicy(userId, {
    cooldownMs: 600000,
  });
  const cooldownHook = cooldownPolicy.hooks.items.find(
    (item) => item.id === "scheduled-hook"
  );
  expect(cooldownPolicy.hooks.schedulingPolicy.cooldownMs).toBe(600000);
  expect(cooldownHook?.scheduling.status).toBe("cooldown");
  expect(
    cooldownPolicy.capabilities.capabilities.find(
      (item) => item.id === "hook.project.scheduled-hook"
    )?.enabled
  ).toBe(false);

  const cooldownApprovalId = await approveHookRunOperation(service, "scheduled-hook");
  const cooldownRun = await service.runHook(userId, {
    hookId: "scheduled-hook",
    confirmation: "RUN HOOK scheduled-hook",
    operationApprovalId: cooldownApprovalId,
  });
  const cooldownLastRun = cooldownRun.hooks.items.find(
    (item) => item.id === "scheduled-hook"
  )?.lastRun;
  expect(cooldownLastRun?.status).toBe("disabled");
  expect(cooldownLastRun?.diagnostics.join("\n")).toContain("cooldown");
  expect(await readFile(outputPath, "utf8")).toBe("1");

  const pausedPolicy = await service.updateHookSchedulingPolicy(userId, {
    enabled: false,
    cooldownMs: 0,
  });
  const pausedHook = pausedPolicy.hooks.items.find(
    (item) => item.id === "scheduled-hook"
  );
  expect(pausedPolicy.hooks.schedulingPolicy.enabled).toBe(false);
  expect(pausedHook?.scheduling.status).toBe("paused");
  const pausedApprovalId = await approveHookRunOperation(service, "scheduled-hook");
  const pausedRun = await service.runHook(userId, {
    hookId: "scheduled-hook",
    confirmation: "RUN HOOK scheduled-hook",
    operationApprovalId: pausedApprovalId,
  });
  const pausedLastRun = pausedRun.hooks.items.find(
    (item) => item.id === "scheduled-hook"
  )?.lastRun;
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
  );
  expect(pausedLastRun?.status).toBe("disabled");
  expect(pausedLastRun?.diagnostics.join("\n")).toContain("scheduling is paused");
  expect(await readFile(outputPath, "utf8")).toBe("1");
  expect(stored.schedulingPolicy.enabled).toBe(false);
  expect(stored.schedulingPolicy.cooldownMs).toBe(0);
});

test("runs guarded hook batch queue with fingerprint rechecks", async () => {
  const firstScript = path.join(tempRoot, "hook-batch-first.js");
  const secondScript = path.join(tempRoot, "hook-batch-second.js");
  const firstOutput = path.join(tempRoot, "hook-batch-first.txt");
  const secondOutput = path.join(tempRoot, "hook-batch-second.txt");
  await writeFile(
    firstScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(firstOutput)}, 'first');`,
      "process.stdout.write('hook batch first ok');",
    ].join(" "),
    "utf8"
  );
  await writeFile(
    secondScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(secondOutput)}, 'second');`,
      "process.stdout.write('hook batch second ok');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const savedFirst = await service.upsertHook(userId, {
    id: "hook-batch-first",
    name: "Hook Batch First",
    command: process.execPath,
    args: [firstScript],
    timeoutMs: 5000,
  });
  await service.trustHook(userId, {
    hookId: "hook-batch-first",
    fingerprint:
      savedFirst.hooks.items.find((item) => item.id === "hook-batch-first")
        ?.fingerprint ?? "",
  });
  const savedSecond = await service.upsertHook(userId, {
    id: "hook-batch-second",
    name: "Hook Batch Second",
    command: process.execPath,
    args: [secondScript],
    timeoutMs: 5000,
  });
  const trustedSecond = await service.trustHook(userId, {
    hookId: "hook-batch-second",
    fingerprint:
      savedSecond.hooks.items.find((item) => item.id === "hook-batch-second")
        ?.fingerprint ?? "",
  });
  const fingerprints = Object.fromEntries(
    trustedSecond.hooks.items
      .filter((item) => item.id.startsWith("hook-batch-"))
      .map((item) => [item.id, item.runOperation.fingerprint])
  );

  await expect(
    service.runHookBatch(userId, {
      hookIds: ["hook-batch-first"],
      operationFingerprints: {
        "hook-batch-first": fingerprints["hook-batch-first"] ?? "",
      },
      confirmation: "RUN HOOK wrong",
    })
  ).rejects.toThrow("Hook batch confirmation mismatch");

  const result = await service.runHookBatch(userId, {
    hookIds: ["hook-batch-first", "hook-batch-second"],
    operationFingerprints: fingerprints,
    confirmation: "RUN HOOK BATCH",
    failureMode: "stop-on-failure",
  });
  const first = result.hooks.items.find((item) => item.id === "hook-batch-first");
  const second = result.hooks.items.find((item) => item.id === "hook-batch-second");
  const batch = result.hooks.recentBatches[0];
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
  );

  expect(first?.lastRun?.status).toBe("success");
  expect(second?.lastRun?.status).toBe("success");
  expect(first?.lastRun?.batchId?.startsWith("hook-batch-")).toBe(true);
  expect(second?.lastRun?.batchId).toBe(first?.lastRun?.batchId);
  expect(batch?.status).toBe("success");
  expect(batch?.failureMode).toBe("stop-on-failure");
  expect(batch?.counts.success).toBe(2);
  expect(stored.batches[0].id).toBe(batch?.id);
  expect(await readFile(firstOutput, "utf8")).toBe("first");
  expect(await readFile(secondOutput, "utf8")).toBe("second");
});

test("terminates hook and plugin child process trees on timeout", async () => {
  const makeParentScript = async (name: string, sentinelPath: string) => {
    const scriptPath = path.join(tempRoot, `${name}.js`);
    await writeFile(
      scriptPath,
      [
        "const { spawn } = require('node:child_process');",
        `const sentinel = ${JSON.stringify(sentinelPath)};`,
        "const code = `setTimeout(()=>require('node:fs').writeFileSync(process.argv[1], 'orphan'), 1500);`;",
        "const child = spawn(process.execPath, ['-e', code, sentinel], { stdio: 'ignore' });",
        "child.unref();",
        "setTimeout(() => {}, 10000);",
      ].join("\n"),
      "utf8"
    );
    return scriptPath;
  };
  const hookSentinel = path.join(tempRoot, "hook-orphan.txt");
  const pluginSentinel = path.join(tempRoot, "plugin-orphan.txt");
  const hookScript = await makeParentScript("hook-timeout-parent", hookSentinel);
  const pluginScript = await makeParentScript(
    "plugin-timeout-parent",
    pluginSentinel
  );
  const service = createService();

  const savedHook = await service.upsertHook(userId, {
    id: "tree-kill-hook",
    name: "Tree Kill Hook",
    command: process.execPath,
    args: [hookScript],
    timeoutMs: 500,
  });
  await service.trustHook(userId, {
    hookId: "tree-kill-hook",
    fingerprint:
      savedHook.hooks.items.find((item) => item.id === "tree-kill-hook")
        ?.fingerprint ?? "",
  });
  const hookApprovalId = await approveHookRunOperation(service, "tree-kill-hook");
  const hookRun = await service.runHook(userId, {
    hookId: "tree-kill-hook",
    confirmation: "RUN HOOK tree-kill-hook",
    operationApprovalId: hookApprovalId,
  });
  const hookLastRun = hookRun.hooks.items.find(
    (item) => item.id === "tree-kill-hook"
  )?.lastRun;
  expect(hookLastRun?.status).toBe("timeout");
  expect(hookLastRun?.isolation?.processTreeTerminated).toBe(true);
  expect(hookLastRun?.diagnostics.join("\n")).toContain("Process tree termination");

  const savedPlugin = await service.upsertPlugin(userId, {
    id: "tree-kill-plugin",
    name: "Tree Kill Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [pluginScript],
    timeoutMs: 500,
  });
  await service.trustPlugin(userId, {
    pluginId: "tree-kill-plugin",
    fingerprint:
      savedPlugin.plugins.items.find((item) => item.id === "tree-kill-plugin")
        ?.fingerprint ?? "",
  });
  const pluginApprovalId = await approvePluginRunOperation(
    service,
    "tree-kill-plugin"
  );
  const pluginRun = await service.runPlugin(userId, {
    pluginId: "tree-kill-plugin",
    confirmation: "RUN PLUGIN tree-kill-plugin",
    operationApprovalId: pluginApprovalId,
  });
  const pluginLastRun = pluginRun.plugins.items.find(
    (item) => item.id === "tree-kill-plugin"
  )?.lastRun;
  expect(pluginLastRun?.status).toBe("timeout");
  expect(pluginLastRun?.isolation?.cwdScope).toBe("temporary-sandbox");
  expect(pluginLastRun?.isolation?.processTreeTerminated).toBe(true);
  expect(pluginLastRun?.diagnostics.join("\n")).toContain(
    "Process tree termination"
  );

  await new Promise((resolve) => setTimeout(resolve, 1800));
  expect(existsSync(hookSentinel)).toBe(false);
  expect(existsSync(pluginSentinel)).toBe(false);
});

test("upserts toggles and runs project hooks with redacted output", async () => {
  const hookScript = path.join(tempRoot, "hook-fixture.js");
  await writeFile(
    hookScript,
    [
      'process.stdout.write(`hook event=${process.env.ERAGEAR_HOOK_EVENT} root=${Boolean(process.env.ERAGEAR_PROJECT_ROOT)}\\n`);',
      'process.stdout.write(`allowed_secret=${process.env.LOCAL_ADE_HOOK_ALLOWED}\\n`);',
      'process.stdout.write(`blocked=${Boolean(process.env.LOCAL_ADE_HOOK_BLOCKED)}\\n`);',
      'process.stderr.write("api_key=super-secret-value\\n");',
    ].join("\n"),
    "utf8"
  );

  const service = createService();
  const previousAllowed = process.env.LOCAL_ADE_HOOK_ALLOWED;
  const previousBlocked = process.env.LOCAL_ADE_HOOK_BLOCKED;
  process.env.LOCAL_ADE_HOOK_ALLOWED = "unit-hook-secret";
  process.env.LOCAL_ADE_HOOK_BLOCKED = "blocked-unit-hook-secret";
  try {
    const saved = await service.upsertHook(userId, {
      id: "hook-test",
      name: "Smoke Hook",
      event: "Manual Check",
      envKeys: ["LOCAL_ADE_HOOK_ALLOWED"],
      command: process.execPath,
      args: [hookScript],
      timeoutMs: 5000,
    });
    const hook = saved.hooks.items.find((item) => item.id === "hook-test");
    const capability = saved.capabilities.capabilities.find(
      (item) => item.id === "hook.project.hook-test"
    );

    expect(hook?.name).toBe("Smoke Hook");
    expect(hook?.event).toBe("manual-check");
    expect(hook?.enabled).toBe(true);
    expect(hook?.envKeys).toEqual(["LOCAL_ADE_HOOK_ALLOWED"]);
    expect(hook?.fingerprint.startsWith("sha256:")).toBe(true);
    expect(hook?.runConfirmationToken).toBe("RUN HOOK hook-test");
    expect(hook?.trustStatus).toBe("untrusted");
    expect(capability?.kind).toBe("hook");
    expect(capability?.enabled).toBe(false);
    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("must be trusted");

    const disabled = await service.toggleHook(userId, {
      id: "hook-test",
      enabled: false,
    });
    expect(disabled.hooks.items.find((item) => item.id === "hook-test")?.enabled).toBe(
      false
    );
    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("Hook is disabled");

    await service.toggleHook(userId, { id: "hook-test", enabled: true });
    const trusted = await service.trustHook(userId, {
      hookId: "hook-test",
      fingerprint: hook?.fingerprint ?? "",
    });
    expect(trusted.hooks.items.find((item) => item.id === "hook-test")?.trustStatus).toBe(
      "trusted"
    );
    expect(
      trusted.capabilities.capabilities.find((item) => item.id === "hook.project.hook-test")
        ?.enabled
    ).toBe(true);

    const changed = await service.upsertHook(userId, {
      id: "hook-test",
      name: "Smoke Hook",
      event: "Manual Check",
      envKeys: ["LOCAL_ADE_HOOK_ALLOWED"],
      command: process.execPath,
      args: [hookScript, "--changed"],
      timeoutMs: 5000,
    });
    const changedHook = changed.hooks.items.find((item) => item.id === "hook-test");
    expect(changedHook?.trustStatus).toBe("changed");
    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("changed after trust approval");
    await service.trustHook(userId, {
      hookId: "hook-test",
      fingerprint: changedHook?.fingerprint ?? "",
    });

    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK wrong",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("confirmation mismatch");

    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("must be approved");
    await expect(
      service.approveHookRun(userId, {
        hookId: "hook-test",
        operationFingerprint: "sha256:not-current",
      })
    ).rejects.toThrow("run operation changed");

    const runApprovalId = await approveHookRunOperation(service, "hook-test");
    const ran = await service.runHook(userId, {
      hookId: "hook-test",
      confirmation: "RUN HOOK hook-test",
      operationApprovalId: runApprovalId,
    });
    const ranHook = ran.hooks.items.find((item) => item.id === "hook-test");
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
    );

    expect(ranHook?.lastRun?.status).toBe("success");
    expect(ranHook?.runOperation.approvalStatus).toBe("consumed");
    expect(ranHook?.lastRun?.stdout).toContain("hook event=manual-check");
    expect(ranHook?.lastRun?.stdout).toContain("allowed_secret= [redacted]");
    expect(ranHook?.lastRun?.stdout).toContain("blocked=false");
    expect(ranHook?.lastRun?.stdout).not.toContain("unit-hook-secret");
    expect(ranHook?.lastRun?.stdout).not.toContain("blocked-unit-hook-secret");
    expect(ranHook?.lastRun?.stderr).toContain("api_key= [redacted]");
    expect(ranHook?.lastRun?.stderr).not.toContain("super-secret-value");
    expect(ranHook?.lastRun?.reviewedAt).toBeUndefined();
    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: runApprovalId,
      })
    ).rejects.toThrow("must be approved");
    const expiredApprovalId = await approveHookRunOperation(service, "hook-test");
    const hookDocumentPath = path.join(tempRoot, ".eragear", "hooks.json");
    const hookDocument = JSON.parse(await readFile(hookDocumentPath, "utf8"));
    hookDocument.approvals = hookDocument.approvals.map(
      (approval: Record<string, unknown>) =>
        approval.id === expiredApprovalId
          ? { ...approval, expiresAt: "2025-01-01T00:00:00.000Z" }
          : approval
    );
    await writeFile(
      hookDocumentPath,
      `${JSON.stringify(hookDocument, null, 2)}\n`,
      "utf8"
    );
    await expect(
      service.runHook(userId, {
        hookId: "hook-test",
        confirmation: "RUN HOOK hook-test",
        operationApprovalId: expiredApprovalId,
      })
    ).rejects.toThrow("approval expired");
    expect(stored.runs[0].status).toBe("success");
    expect(stored.runs[0].stderr).not.toContain("super-secret-value");

    const reviewed = await service.reviewHookRun(userId, {
      runId: ranHook?.lastRun?.id ?? "",
      reviewed: true,
    });
    const reviewedHook = reviewed.hooks.items.find((item) => item.id === "hook-test");
    const reviewedStored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
    );
    expect(reviewedHook?.lastRun?.reviewedAt).toBeDefined();
    expect(reviewedStored.runs[0].reviewedAt).toBe(reviewedHook?.lastRun?.reviewedAt);

    const reviewedAudit = await service.exportHookRuns(userId, {
      reviewState: "reviewed",
      status: "success",
      limit: 1,
    });
    expect(reviewedAudit.schemaVersion).toBe(1);
    expect(reviewedAudit.redacted).toBe(true);
    expect(reviewedAudit.projectRoot).toBe(tempRoot);
    expect(reviewedAudit.filters).toEqual({
      reviewState: "reviewed",
      status: "success",
      limit: 1,
    });
    expect(reviewedAudit.stats.total).toBe(1);
    expect(reviewedAudit.stats.matching).toBe(1);
    expect(reviewedAudit.stats.included).toBe(1);
    expect(reviewedAudit.stats.reviewed).toBe(1);
    expect(reviewedAudit.stats.open).toBe(0);
    expect(reviewedAudit.runs[0]?.id).toBe(ranHook?.lastRun?.id);
    expect(reviewedAudit.runs[0]?.reviewedAt).toBeDefined();
    expect(JSON.stringify(reviewedAudit)).not.toContain("unit-hook-secret");
    expect(JSON.stringify(reviewedAudit)).not.toContain("super-secret-value");

    const reopened = await service.reviewHookRun(userId, {
      runId: ranHook?.lastRun?.id ?? "",
      reviewed: false,
    });
    const reopenedHook = reopened.hooks.items.find((item) => item.id === "hook-test");
    expect(reopenedHook?.lastRun?.reviewedAt).toBeUndefined();
    const openAudit = await service.exportHookRuns(userId, {
      reviewState: "open",
    });
    expect(openAudit.stats.matching).toBe(1);
    expect(openAudit.runs[0]?.id).toBe(ranHook?.lastRun?.id);

    const blockedShell = await service.upsertHook(userId, {
      id: "hook-shell-eval",
      name: "Shell Eval Hook",
      command: process.platform === "win32" ? "powershell" : "sh",
      args:
        process.platform === "win32"
          ? ["-NoProfile", "-Command", "Write-Output blocked"]
          : ["-c", "printf blocked"],
    });
    const shellHook = blockedShell.hooks.items.find(
      (item) => item.id === "hook-shell-eval"
    );
    expect(shellHook?.executionPolicy.status).toBe("blocked");
    expect(
      blockedShell.capabilities.capabilities.find(
        (item) => item.id === "hook.project.hook-shell-eval"
      )?.enabled
    ).toBe(false);
    const trustedShell = await service.trustHook(userId, {
      hookId: "hook-shell-eval",
      fingerprint: shellHook?.fingerprint ?? "",
    });
    expect(
      trustedShell.hooks.items.find((item) => item.id === "hook-shell-eval")
        ?.trustStatus
    ).toBe("trusted");
    expect(
      trustedShell.capabilities.capabilities.find(
        (item) => item.id === "hook.project.hook-shell-eval"
      )?.enabled
    ).toBe(false);
    await expect(
      service.runHook(userId, {
        hookId: "hook-shell-eval",
        confirmation: "RUN HOOK hook-shell-eval",
        operationApprovalId: "hook-approval-unused",
      })
    ).rejects.toThrow("sandbox");

    const restrictedPolicy = await service.upsertHook(userId, {
      id: "hook-policy-restricted",
      name: "Restricted Policy Hook",
      policyPreset: "restricted",
      command: process.execPath,
      args: [hookScript],
      timeoutMs: 5000,
    });
    const restrictedHook = restrictedPolicy.hooks.items.find(
      (item) => item.id === "hook-policy-restricted"
    );
    expect(restrictedHook?.policyPreset).toBe("restricted");
    expect(restrictedHook?.executionPolicy.status).toBe("blocked");
    expect(restrictedHook?.executionPolicy.blockers.join("\n")).toContain(
      "restricted policy"
    );
    expect(
      restrictedPolicy.capabilities.capabilities.find(
        (item) => item.id === "hook.project.hook-policy-restricted"
      )?.enabled
    ).toBe(false);
    const trustedRestrictedHook = await service.trustHook(userId, {
      hookId: "hook-policy-restricted",
      fingerprint: restrictedHook?.fingerprint ?? "",
    });
    expect(
      trustedRestrictedHook.capabilities.capabilities.find(
        (item) => item.id === "hook.project.hook-policy-restricted"
      )?.enabled
    ).toBe(false);
    await expect(
      service.approveHookRun(userId, {
        hookId: "hook-policy-restricted",
        operationFingerprint: restrictedHook?.runOperation.fingerprint ?? "",
      })
    ).rejects.toThrow("restricted policy");

    const blockedPolicy = await service.upsertHook(userId, {
      id: "hook-policy-blocked",
      name: "Blocked Policy Hook",
      policyPreset: "blocked",
      command: process.execPath,
      args: [hookScript],
      timeoutMs: 5000,
    });
    const blockedPolicyHook = blockedPolicy.hooks.items.find(
      (item) => item.id === "hook-policy-blocked"
    );
    expect(blockedPolicyHook?.policyPreset).toBe("blocked");
    expect(blockedPolicyHook?.executionPolicy.status).toBe("blocked");
    await service.trustHook(userId, {
      hookId: "hook-policy-blocked",
      fingerprint: blockedPolicyHook?.fingerprint ?? "",
    });
    await expect(
      service.approveHookRun(userId, {
        hookId: "hook-policy-blocked",
        operationFingerprint: blockedPolicyHook?.runOperation.fingerprint ?? "",
      })
    ).rejects.toThrow("blocked policy preset");
  } finally {
    if (previousAllowed === undefined) {
      delete process.env.LOCAL_ADE_HOOK_ALLOWED;
    } else {
      process.env.LOCAL_ADE_HOOK_ALLOWED = previousAllowed;
    }
    if (previousBlocked === undefined) {
      delete process.env.LOCAL_ADE_HOOK_BLOCKED;
    } else {
      process.env.LOCAL_ADE_HOOK_BLOCKED = previousBlocked;
    }
  }

  await expect(
    service.upsertHook(userId, {
      name: "Escaping Hook",
      command: process.execPath,
      workingDirectory: "..",
    })
  ).rejects.toThrow("inside the project root");
});

test("runs agent session lifecycle hooks with session context", async () => {
  const hookScript = path.join(tempRoot, "agent-lifecycle-hook.js");
  await writeFile(
    hookScript,
    [
      "process.stdout.write([",
      "  process.env.ERAGEAR_HOOK_EVENT,",
      "  process.env.ERAGEAR_CHAT_ID,",
      "  process.env.ERAGEAR_AGENT_SESSION_ID,",
      "  process.env.ERAGEAR_TURN_ID,",
      "  process.env.ERAGEAR_PROJECT_ID,",
      "].join('|'));",
      "",
    ].join("\n"),
    "utf8"
  );

  const service = createService();
  const saved = await service.upsertHook(userId, {
    id: "agent-message-hook",
    name: "Agent Message Hook",
    event: "after-agent-message-send",
    command: process.execPath,
    args: [hookScript],
  });
  const agentHook = saved.hooks.items.find((item) => item.id === "agent-message-hook");
  await service.trustHook(userId, {
    hookId: "agent-message-hook",
    fingerprint: agentHook?.fingerprint ?? "",
  });

  await service.handleLifecycleEvent({
    type: "local_ade_lifecycle",
    event: "after-agent-message-send",
    userId,
    projectRoot: tempRoot,
    projectId: "project-1",
    chatId: "chat-lifecycle-1",
    agentSessionId: "agent-session-1",
    turnId: "turn-1",
  });

  const snapshot = await service.snapshot(userId);
  const hook = snapshot.hooks.items.find((item) => item.id === "agent-message-hook");

  expect(hook?.lastRun?.status).toBe("success");
  expect(hook?.lastRun?.stdout).toContain(
    "after-agent-message-send|chat-lifecycle-1|agent-session-1|turn-1|project-1"
  );
});

test("upserts toggles and runs project plugins with redacted output", async () => {
  const pluginScript = path.join(tempRoot, "plugin-fixture.js");
  await writeFile(
    pluginScript,
    [
      'process.stdout.write(`plugin name=${process.env.ERAGEAR_PLUGIN_NAME} root=${Boolean(process.env.ERAGEAR_PROJECT_ROOT)}\\n`);',
      'process.stdout.write(`scopes=${process.env.ERAGEAR_PLUGIN_SCOPES}\\n`);',
      'process.stdout.write(`allowed_secret=${process.env.LOCAL_ADE_PLUGIN_ALLOWED}\\n`);',
      'process.stdout.write(`blocked=${Boolean(process.env.LOCAL_ADE_PLUGIN_BLOCKED)}\\n`);',
      'process.stderr.write("token=plugin-secret-value\\n");',
    ].join("\n"),
    "utf8"
  );

  const service = createService();
  const previousAllowed = process.env.LOCAL_ADE_PLUGIN_ALLOWED;
  const previousBlocked = process.env.LOCAL_ADE_PLUGIN_BLOCKED;
  process.env.LOCAL_ADE_PLUGIN_ALLOWED = "unit-plugin-secret";
  process.env.LOCAL_ADE_PLUGIN_BLOCKED = "blocked-unit-plugin-secret";
  try {
  const saved = await service.upsertPlugin(userId, {
    id: "plugin-test",
    name: "Smoke Plugin",
    description: "Runs a smoke plugin command.",
    scopes: ["process", "project-root", "env"],
    envKeys: ["LOCAL_ADE_PLUGIN_ALLOWED"],
    command: process.execPath,
    args: [pluginScript],
    timeoutMs: 5000,
  });
  const plugin = saved.plugins.items.find((item) => item.id === "plugin-test");
  const capability = saved.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.plugin-test"
  );

  expect(plugin?.name).toBe("Smoke Plugin");
  expect(plugin?.description).toBe("Runs a smoke plugin command.");
  expect(plugin?.enabled).toBe(true);
  expect(plugin?.scopes).toEqual(["process", "project-root", "env"]);
  expect(plugin?.envKeys).toEqual(["LOCAL_ADE_PLUGIN_ALLOWED"]);
  expect(plugin?.fingerprint.startsWith("sha256:")).toBe(true);
  expect(plugin?.permissionFingerprint.startsWith("sha256:")).toBe(true);
  expect(plugin?.permissionStatus).toBe("missing");
  expect(plugin?.runConfirmationToken).toBe("RUN PLUGIN plugin-test");
  expect(plugin?.trustStatus).toBe("untrusted");
  expect(capability?.kind).toBe("plugin");
  expect(capability?.enabled).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("must be trusted");
  await expect(
    service.trustPlugin(userId, {
      pluginId: "plugin-test",
      fingerprint: "sha256:not-current",
    })
  ).rejects.toThrow("fingerprint changed");
  const trusted = await service.trustPlugin(userId, {
    pluginId: "plugin-test",
    fingerprint: plugin?.fingerprint ?? "",
  });
  const trustedPlugin = trusted.plugins.items.find((item) => item.id === "plugin-test");
  const trustedCapability = trusted.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.plugin-test"
  );
  expect(trustedPlugin?.trustStatus).toBe("trusted");
  expect(trustedPlugin?.trustedFingerprint).toBe(trustedPlugin?.fingerprint);
  expect(trustedPlugin?.trustedAt).toBeDefined();
  expect(trustedPlugin?.permissionStatus).toBe("granted");
  expect(trustedPlugin?.grantedPermissionFingerprint).toBe(
    trustedPlugin?.permissionFingerprint
  );
  expect(trustedPlugin?.permissionGrantedAt).toBeDefined();
  expect(trustedCapability?.enabled).toBe(true);

  const permissionRevoked = await service.updatePluginPermissionGrant(userId, {
    pluginId: "plugin-test",
    permissionFingerprint: trustedPlugin?.permissionFingerprint ?? "",
    granted: false,
  });
  const revokedPlugin = permissionRevoked.plugins.items.find(
    (item) => item.id === "plugin-test"
  );
  expect(revokedPlugin?.permissionStatus).toBe("missing");
  expect(
    permissionRevoked.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-test"
    )?.enabled
  ).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("permissions must be granted");
  await expect(
    service.updatePluginPermissionGrant(userId, {
      pluginId: "plugin-test",
      permissionFingerprint: "sha256:not-current",
      granted: true,
    })
  ).rejects.toThrow("permission fingerprint changed");
  const permissionGranted = await service.updatePluginPermissionGrant(userId, {
    pluginId: "plugin-test",
    permissionFingerprint: revokedPlugin?.permissionFingerprint ?? "",
    granted: true,
  });
  expect(
    permissionGranted.plugins.items.find((item) => item.id === "plugin-test")
      ?.permissionStatus
  ).toBe("granted");
  expect(
    permissionGranted.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-test"
    )?.enabled
  ).toBe(true);

  const disabled = await service.updateCapabilityState(userId, {
    capabilityId: "plugin.project.plugin-test",
    enabled: false,
  });
  expect(
    disabled.plugins.items.find((item) => item.id === "plugin-test")?.enabled
  ).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("Plugin is disabled");

  await service.togglePlugin(userId, { id: "plugin-test", enabled: true });
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN wrong",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("confirmation mismatch");
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("must be approved");
  await expect(
    service.approvePluginRun(userId, {
      pluginId: "plugin-test",
      operationFingerprint: "sha256:not-current",
    })
  ).rejects.toThrow("run operation changed");

  const runApprovalId = await approvePluginRunOperation(service, "plugin-test");
  const ran = await service.runPlugin(userId, {
    pluginId: "plugin-test",
    confirmation: "RUN PLUGIN plugin-test",
    operationApprovalId: runApprovalId,
  });
  const ranPlugin = ran.plugins.items.find((item) => item.id === "plugin-test");
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(ranPlugin?.lastRun?.status).toBe("success");
  expect(ranPlugin?.runOperation.approvalStatus).toBe("consumed");
  expect(ranPlugin?.lastRun?.stdout).toContain("plugin name=Smoke Plugin");
  expect(ranPlugin?.lastRun?.stdout).toContain("scopes=process,project-root,env");
  expect(ranPlugin?.lastRun?.stdout).toContain("allowed_secret= [redacted]");
  expect(ranPlugin?.lastRun?.stdout).toContain("blocked=false");
  expect(ranPlugin?.lastRun?.stdout).not.toContain("unit-plugin-secret");
  expect(ranPlugin?.lastRun?.stdout).not.toContain("blocked-unit-plugin-secret");
  expect(ranPlugin?.lastRun?.stderr).toContain("token= [redacted]");
  expect(ranPlugin?.lastRun?.stderr).not.toContain("plugin-secret-value");
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: runApprovalId,
    })
  ).rejects.toThrow("must be approved");
  const expiredApprovalId = await approvePluginRunOperation(service, "plugin-test");
  const pluginDocumentPath = path.join(tempRoot, ".eragear", "plugins.json");
  const pluginDocument = JSON.parse(await readFile(pluginDocumentPath, "utf8"));
  pluginDocument.approvals = pluginDocument.approvals.map(
    (approval: Record<string, unknown>) =>
      approval.id === expiredApprovalId
        ? { ...approval, expiresAt: "2025-01-01T00:00:00.000Z" }
        : approval
  );
  await writeFile(
    pluginDocumentPath,
    `${JSON.stringify(pluginDocument, null, 2)}\n`,
    "utf8"
  );
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: expiredApprovalId,
    })
  ).rejects.toThrow("approval expired");
  expect(stored.plugins[0].id).toBe("plugin-test");
  expect(stored.plugins[0].scopes).toEqual(["process", "project-root", "env"]);
  expect(stored.plugins[0].envKeys).toEqual(["LOCAL_ADE_PLUGIN_ALLOWED"]);
  expect(stored.plugins[0].trustedFingerprint).toBe(ranPlugin?.fingerprint);
  expect(stored.plugins[0].grantedPermissionFingerprint).toBe(
    ranPlugin?.permissionFingerprint
  );
  expect(stored.runs[0].status).toBe("success");
  expect(stored.runs[0].stderr).not.toContain("plugin-secret-value");
  expect(ranPlugin?.lastRun?.reviewedAt).toBeUndefined();

  const reviewed = await service.reviewPluginRun(userId, {
    runId: ranPlugin?.lastRun?.id ?? "",
    reviewed: true,
  });
  const reviewedPlugin = reviewed.plugins.items.find((item) => item.id === "plugin-test");
  const reviewedStored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );
  expect(reviewedPlugin?.lastRun?.reviewedAt).toBeDefined();
  expect(reviewedStored.runs[0].reviewedAt).toBe(
    reviewedPlugin?.lastRun?.reviewedAt
  );

  const reviewedAudit = await service.exportPluginRuns(userId, {
    reviewState: "reviewed",
    status: "success",
    limit: 1,
  });
  expect(reviewedAudit.schemaVersion).toBe(1);
  expect(reviewedAudit.redacted).toBe(true);
  expect(reviewedAudit.projectRoot).toBe(tempRoot);
  expect(reviewedAudit.filters).toEqual({
    reviewState: "reviewed",
    status: "success",
    limit: 1,
  });
  expect(reviewedAudit.stats.total).toBe(1);
  expect(reviewedAudit.stats.matching).toBe(1);
  expect(reviewedAudit.stats.included).toBe(1);
  expect(reviewedAudit.stats.reviewed).toBe(1);
  expect(reviewedAudit.stats.open).toBe(0);
  expect(reviewedAudit.runs[0]?.id).toBe(ranPlugin?.lastRun?.id);
  expect(reviewedAudit.runs[0]?.reviewedAt).toBeDefined();
  expect(JSON.stringify(reviewedAudit)).not.toContain("unit-plugin-secret");
  expect(JSON.stringify(reviewedAudit)).not.toContain("plugin-secret-value");

  const reopened = await service.reviewPluginRun(userId, {
    runId: ranPlugin?.lastRun?.id ?? "",
    reviewed: false,
  });
  const reopenedPlugin = reopened.plugins.items.find((item) => item.id === "plugin-test");
  expect(reopenedPlugin?.lastRun?.reviewedAt).toBeUndefined();
  const openAudit = await service.exportPluginRuns(userId, {
    reviewState: "open",
  });
  expect(openAudit.stats.matching).toBe(1);
  expect(openAudit.runs[0]?.id).toBe(ranPlugin?.lastRun?.id);

  const blockedShell = await service.upsertPlugin(userId, {
    id: "plugin-shell-eval",
    name: "Shell Eval Plugin",
    command: process.platform === "win32" ? "powershell" : "sh",
    args:
      process.platform === "win32"
        ? ["-NoProfile", "-Command", "Write-Output blocked"]
        : ["-c", "printf blocked"],
  });
  const shellPlugin = blockedShell.plugins.items.find(
    (item) => item.id === "plugin-shell-eval"
  );
  expect(shellPlugin?.executionPolicy.status).toBe("blocked");
  expect(
    blockedShell.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-shell-eval"
    )?.enabled
  ).toBe(false);
  const trustedShell = await service.trustPlugin(userId, {
    pluginId: "plugin-shell-eval",
    fingerprint: shellPlugin?.fingerprint ?? "",
  });
  expect(
    trustedShell.plugins.items.find((item) => item.id === "plugin-shell-eval")
      ?.trustStatus
  ).toBe("trusted");
  expect(
    trustedShell.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-shell-eval"
    )?.enabled
  ).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-shell-eval",
      confirmation: "RUN PLUGIN plugin-shell-eval",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("sandbox");

  const restricted = await service.upsertPlugin(userId, {
    id: "plugin-sandbox",
    name: "Sandboxed Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(process.cwd(), 'restricted-output.txt'), 'written');",
        "process.stdout.write(`root=${Boolean(process.env.ERAGEAR_PROJECT_ROOT)} access=${process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS} scopes=${process.env.ERAGEAR_PLUGIN_SCOPES}`);",
      ].join(" "),
    ],
    timeoutMs: 5000,
  });
  const restrictedPlugin = restricted.plugins.items.find(
    (item) => item.id === "plugin-sandbox"
  );
  expect(restrictedPlugin?.scopes).toEqual(["process"]);
  expect(restrictedPlugin?.diagnostics.join("\n")).toContain("temporary sandbox cwd");
  const trustedRestricted = await service.trustPlugin(userId, {
    pluginId: "plugin-sandbox",
    fingerprint: restrictedPlugin?.fingerprint ?? "",
  });
  expect(
    trustedRestricted.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-sandbox"
    )?.tags
  ).toContain("workspace:sandbox");
  const sandboxApprovalId = await approvePluginRunOperation(
    service,
    "plugin-sandbox"
  );
  const sandboxRun = await service.runPlugin(userId, {
    pluginId: "plugin-sandbox",
    confirmation: "RUN PLUGIN plugin-sandbox",
    operationApprovalId: sandboxApprovalId,
  });
  const sandboxPlugin = sandboxRun.plugins.items.find(
    (item) => item.id === "plugin-sandbox"
  );
  expect(sandboxPlugin?.lastRun?.status).toBe("success");
  expect(sandboxPlugin?.lastRun?.stdout).toContain("root=false");
  expect(sandboxPlugin?.lastRun?.stdout).toContain("access=sandbox");
  expect(sandboxPlugin?.lastRun?.stdout).toContain("scopes=process");
  expect(sandboxPlugin?.lastRun?.diagnostics.join("\n")).toContain(
    "ERAGEAR_PROJECT_ROOT was not exposed"
  );
  expect(existsSync(path.join(tempRoot, "restricted-output.txt"))).toBe(false);

  const restrictedPreset = await service.upsertPlugin(userId, {
    id: "plugin-policy-restricted",
    name: "Restricted Policy Plugin",
    policyPreset: "restricted",
    scopes: ["process", "project-root"],
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(process.cwd(), 'restricted-policy-output.txt'), 'written');",
        "process.stdout.write([",
        "`root=${Boolean(process.env.ERAGEAR_PROJECT_ROOT)}`,",
        "`access=${process.env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS}`,",
        "`scopes=${process.env.ERAGEAR_PLUGIN_SCOPES}`,",
        "`policy=${process.env.ERAGEAR_PLUGIN_POLICY_PRESET}`",
        "].join('\\n'));",
      ].join(" "),
    ],
    timeoutMs: 5000,
  });
  const restrictedPresetPlugin = restrictedPreset.plugins.items.find(
    (item) => item.id === "plugin-policy-restricted"
  );
  expect(restrictedPresetPlugin?.policyPreset).toBe("restricted");
  expect(restrictedPresetPlugin?.scopes).toEqual(["process"]);
  expect(restrictedPresetPlugin?.runOperation.workspaceAccess).toBe("sandbox");
  expect(restrictedPresetPlugin?.diagnostics.join("\n")).toContain(
    "forces sandbox"
  );
  expect(
    restrictedPreset.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-policy-restricted"
    )?.tags
  ).toEqual(
    expect.arrayContaining(["policy:restricted", "workspace:sandbox"])
  );
  await service.trustPlugin(userId, {
    pluginId: "plugin-policy-restricted",
    fingerprint: restrictedPresetPlugin?.fingerprint ?? "",
  });
  const restrictedPresetApprovalId = await approvePluginRunOperation(
    service,
    "plugin-policy-restricted"
  );
  const restrictedPresetRun = await service.runPlugin(userId, {
    pluginId: "plugin-policy-restricted",
    confirmation: "RUN PLUGIN plugin-policy-restricted",
    operationApprovalId: restrictedPresetApprovalId,
  });
  const restrictedPresetRan = restrictedPresetRun.plugins.items.find(
    (item) => item.id === "plugin-policy-restricted"
  );
  expect(restrictedPresetRan?.lastRun?.status).toBe("success");
  expect(restrictedPresetRan?.lastRun?.stdout).toContain("root=false");
  expect(restrictedPresetRan?.lastRun?.stdout).toContain("access=sandbox");
  expect(restrictedPresetRan?.lastRun?.stdout).toContain("scopes=process");
  expect(restrictedPresetRan?.lastRun?.stdout).toContain("policy=restricted");
  expect(existsSync(path.join(tempRoot, "restricted-policy-output.txt"))).toBe(
    false
  );

  const blockedPreset = await service.upsertPlugin(userId, {
    id: "plugin-policy-blocked",
    name: "Blocked Policy Plugin",
    policyPreset: "blocked",
    command: process.execPath,
    args: [pluginScript],
  });
  const blockedPresetPlugin = blockedPreset.plugins.items.find(
    (item) => item.id === "plugin-policy-blocked"
  );
  expect(blockedPresetPlugin?.policyPreset).toBe("blocked");
  expect(blockedPresetPlugin?.executionPolicy.status).toBe("blocked");
  await service.trustPlugin(userId, {
    pluginId: "plugin-policy-blocked",
    fingerprint: blockedPresetPlugin?.fingerprint ?? "",
  });
  await expect(
    service.approvePluginRun(userId, {
      pluginId: "plugin-policy-blocked",
      operationFingerprint: blockedPresetPlugin?.runOperation.fingerprint ?? "",
    })
  ).rejects.toThrow("blocked policy preset");

  const changed = await service.upsertPlugin(userId, {
    id: "plugin-test",
    name: "Smoke Plugin",
    description: "Runs a smoke plugin command.",
    command: process.execPath,
    args: [pluginScript, "changed-input"],
    timeoutMs: 5000,
  });
  const changedPlugin = changed.plugins.items.find((item) => item.id === "plugin-test");
  const changedCapability = changed.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.plugin-test"
  );
  expect(changedPlugin?.trustStatus).toBe("changed");
  expect(changedPlugin?.trustedFingerprint).not.toBe(changedPlugin?.fingerprint);
  expect(changedCapability?.enabled).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "plugin-test",
      confirmation: "RUN PLUGIN plugin-test",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("must be trusted");

  await expect(
    service.upsertPlugin(userId, {
      name: "Escaping Plugin",
      command: process.execPath,
      workingDirectory: "..",
    })
  ).rejects.toThrow("inside the project root");
  } finally {
  if (previousAllowed === undefined) {
    delete process.env.LOCAL_ADE_PLUGIN_ALLOWED;
  } else {
    process.env.LOCAL_ADE_PLUGIN_ALLOWED = previousAllowed;
  }
  if (previousBlocked === undefined) {
    delete process.env.LOCAL_ADE_PLUGIN_BLOCKED;
  } else {
    process.env.LOCAL_ADE_PLUGIN_BLOCKED = previousBlocked;
  }
  }
});

test("enforces plugin scheduling parallel limit before spawn", async () => {
  const longScript = path.join(tempRoot, "plugin-long.js");
  const fastScript = path.join(tempRoot, "plugin-fast.js");
  const longStarted = path.join(tempRoot, "plugin-long-started.txt");
  const longOutput = path.join(tempRoot, "plugin-long-output.txt");
  const fastOutput = path.join(tempRoot, "plugin-fast-output.txt");
  await writeFile(
    longScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(longStarted)}, 'started');`,
      "setTimeout(() => {",
      `fs.writeFileSync(${JSON.stringify(longOutput)}, 'long-ran');`,
      "process.stdout.write('long plugin ran');",
      "}, 500);",
    ].join(" "),
    "utf8"
  );
  await writeFile(
    fastScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(fastOutput)}, 'fast-ran');`,
      "process.stdout.write('fast plugin ran');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const first = await service.upsertPlugin(userId, {
    id: "plugin-long",
    name: "Long Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [longScript],
    timeoutMs: 5000,
  });
  const second = await service.upsertPlugin(userId, {
    id: "plugin-fast",
    name: "Fast Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [fastScript],
    timeoutMs: 5000,
  });
  await service.trustPlugin(userId, {
    pluginId: "plugin-long",
    fingerprint:
      first.plugins.items.find((item) => item.id === "plugin-long")?.fingerprint ?? "",
  });
  await service.trustPlugin(userId, {
    pluginId: "plugin-fast",
    fingerprint:
      second.plugins.items.find((item) => item.id === "plugin-fast")?.fingerprint ??
      "",
  });
  const scheduling = await service.updatePluginSchedulingPolicy(userId, {
    enabled: true,
    maxConcurrentRuns: 1,
    cooldownMs: 0,
  });
  expect(scheduling.plugins.schedulingPolicy.maxConcurrentRuns).toBe(1);
  expect(
    scheduling.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.plugin-long"
    )?.tags
  ).toContain("schedule:ready");

  const longApprovalId = await approvePluginRunOperation(service, "plugin-long");
  const fastApprovalId = await approvePluginRunOperation(service, "plugin-fast");
  const longPromise = service.runPlugin(userId, {
    pluginId: "plugin-long",
    confirmation: "RUN PLUGIN plugin-long",
    operationApprovalId: longApprovalId,
  });
  await waitForFile(longStarted);

  const blocked = await service.runPlugin(userId, {
    pluginId: "plugin-fast",
    confirmation: "RUN PLUGIN plugin-fast",
    operationApprovalId: fastApprovalId,
  });
  const blockedPlugin = blocked.plugins.items.find((item) => item.id === "plugin-fast");
  expect(blockedPlugin?.lastRun?.status).toBe("disabled");
  expect(blockedPlugin?.lastRun?.diagnostics.join("\n")).toContain(
    "parallel run limit"
  );
  expect(blockedPlugin?.runOperation.approvalStatus).toBe("consumed");
  expect(existsSync(fastOutput)).toBe(false);

  const longResult = await longPromise;
  const longPlugin = longResult.plugins.items.find((item) => item.id === "plugin-long");
  expect(longPlugin?.lastRun?.status).toBe("success");
  expect(await readFile(longOutput, "utf8")).toBe("long-ran");

  const paused = await service.updatePluginSchedulingPolicy(userId, {
    enabled: false,
  });
  const pausedPlugin = paused.plugins.items.find((item) => item.id === "plugin-fast");
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );
  expect(paused.plugins.schedulingPolicy.enabled).toBe(false);
  expect(pausedPlugin?.scheduling.status).toBe("paused");
  expect(stored.schedulingPolicy.maxConcurrentRuns).toBe(1);
  expect(stored.schedulingPolicy.enabled).toBe(false);
});

test("runs plugin batch queue with fingerprint guards and persisted summary", async () => {
  const firstScript = path.join(tempRoot, "plugin-batch-first.js");
  const secondScript = path.join(tempRoot, "plugin-batch-second.js");
  const blockedScript = path.join(tempRoot, "plugin-batch-blocked.js");
  const firstOutput = path.join(tempRoot, "plugin-batch-first.txt");
  const secondOutput = path.join(tempRoot, "plugin-batch-second.txt");
  const blockedOutput = path.join(tempRoot, "plugin-batch-blocked.txt");
  await writeFile(
    firstScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(firstOutput)}, 'first');`,
      "process.stdout.write('batch first ok');",
    ].join(" "),
    "utf8"
  );
  await writeFile(
    secondScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(secondOutput)}, 'second');`,
      "process.stdout.write('batch second ok');",
    ].join(" "),
    "utf8"
  );
  await writeFile(
    blockedScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(blockedOutput)}, 'blocked');`,
      "process.stdout.write('batch blocked should not run');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  await service.upsertPlugin(userId, {
    id: "plugin-batch-first",
    name: "Batch First",
    scopes: ["process"],
    command: process.execPath,
    args: [firstScript],
    timeoutMs: 5000,
  });
  await service.upsertPlugin(userId, {
    id: "plugin-batch-second",
    name: "Batch Second",
    scopes: ["process"],
    command: process.execPath,
    args: [secondScript],
    timeoutMs: 5000,
  });
  const blockedSaved = await service.upsertPlugin(userId, {
    id: "plugin-batch-blocked",
    name: "Batch Blocked",
    scopes: ["process"],
    command: process.execPath,
    args: [blockedScript],
    timeoutMs: 5000,
  });
  for (const plugin of blockedSaved.plugins.items.filter((item) =>
    item.id.startsWith("plugin-batch-")
  )) {
    await service.trustPlugin(userId, {
      pluginId: plugin.id,
      fingerprint: plugin.fingerprint,
    });
  }
  const ready = await service.snapshot(userId);
  const fingerprints = Object.fromEntries(
    ready.plugins.items
      .filter((item) => item.id.startsWith("plugin-batch-"))
      .map((item) => [item.id, item.runOperation.fingerprint])
  );

  await expect(
    service.runPluginBatch(userId, {
      pluginIds: ["plugin-batch-first"],
      operationFingerprints: {
        "plugin-batch-first": fingerprints["plugin-batch-first"] ?? "",
      },
      confirmation: "RUN PLUGIN WRONG",
    })
  ).rejects.toThrow("Plugin batch confirmation mismatch");

  const result = await service.runPluginBatch(userId, {
    pluginIds: [
      "plugin-batch-first",
      "plugin-batch-second",
      "plugin-batch-blocked",
    ],
    operationFingerprints: {
      "plugin-batch-first": fingerprints["plugin-batch-first"] ?? "",
      "plugin-batch-second": fingerprints["plugin-batch-second"] ?? "",
      "plugin-batch-blocked": "sha256:0000",
    },
    confirmation: "RUN PLUGIN BATCH",
  });
  const first = result.plugins.items.find((item) => item.id === "plugin-batch-first");
  const second = result.plugins.items.find(
    (item) => item.id === "plugin-batch-second"
  );
  const blocked = result.plugins.items.find(
    (item) => item.id === "plugin-batch-blocked"
  );
  const batch = result.plugins.recentBatches[0];
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(first?.lastRun?.status).toBe("success");
  expect(second?.lastRun?.status).toBe("success");
  expect(blocked?.lastRun?.status).toBe("disabled");
  expect(first?.lastRun?.batchId?.startsWith("plugin-batch-")).toBe(true);
  expect(second?.lastRun?.batchId).toBe(first?.lastRun?.batchId);
  expect(blocked?.lastRun?.batchId).toBe(first?.lastRun?.batchId);
  expect(blocked?.lastRun?.diagnostics.join("\n")).toContain(
    "operation fingerprint changed"
  );
  expect(batch?.status).toBe("partial");
  expect(batch?.counts.success).toBe(2);
  expect(batch?.counts.disabled).toBe(1);
  expect(batch?.runIds.length).toBe(3);
  expect(stored.batches[0].id).toBe(batch?.id);
  expect(stored.runs.filter((run: { batchId?: string }) => run.batchId === batch?.id))
    .toHaveLength(3);
  expect(await readFile(firstOutput, "utf8")).toBe("first");
  expect(await readFile(secondOutput, "utf8")).toBe("second");
  expect(existsSync(blockedOutput)).toBe(false);
});

test("stops plugin batch queue after first failed item when configured", async () => {
  const failingScript = path.join(tempRoot, "plugin-batch-failing.js");
  const skippedScript = path.join(tempRoot, "plugin-batch-skipped.js");
  const skippedOutput = path.join(tempRoot, "plugin-batch-skipped.txt");
  await writeFile(
    failingScript,
    "process.stderr.write('batch failing plugin'); process.exit(7);",
    "utf8"
  );
  await writeFile(
    skippedScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(skippedOutput)}, 'skipped');`,
      "process.stdout.write('batch skipped should not run');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  await service.upsertPlugin(userId, {
    id: "plugin-batch-failing",
    name: "Batch Failing",
    scopes: ["process"],
    command: process.execPath,
    args: [failingScript],
    timeoutMs: 5000,
  });
  const saved = await service.upsertPlugin(userId, {
    id: "plugin-batch-skipped",
    name: "Batch Skipped",
    scopes: ["process"],
    command: process.execPath,
    args: [skippedScript],
    timeoutMs: 5000,
  });
  for (const plugin of saved.plugins.items.filter((item) =>
    item.id.startsWith("plugin-batch-")
  )) {
    await service.trustPlugin(userId, {
      pluginId: plugin.id,
      fingerprint: plugin.fingerprint,
    });
  }
  const ready = await service.snapshot(userId);
  const fingerprints = Object.fromEntries(
    ready.plugins.items
      .filter((item) => item.id.startsWith("plugin-batch-"))
      .map((item) => [item.id, item.runOperation.fingerprint])
  );

  const result = await service.runPluginBatch(userId, {
    pluginIds: ["plugin-batch-failing", "plugin-batch-skipped"],
    operationFingerprints: {
      "plugin-batch-failing": fingerprints["plugin-batch-failing"] ?? "",
      "plugin-batch-skipped": fingerprints["plugin-batch-skipped"] ?? "",
    },
    confirmation: "RUN PLUGIN BATCH",
    failureMode: "stop-on-failure",
  });
  const failing = result.plugins.items.find(
    (item) => item.id === "plugin-batch-failing"
  );
  const skipped = result.plugins.items.find(
    (item) => item.id === "plugin-batch-skipped"
  );
  const batch = result.plugins.recentBatches[0];
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(failing?.lastRun?.status).toBe("failed");
  expect(skipped?.lastRun?.status).toBe("disabled");
  expect(skipped?.lastRun?.batchId).toBe(failing?.lastRun?.batchId);
  expect(skipped?.lastRun?.diagnostics.join("\n")).toContain("stop-on-failure");
  expect(batch?.failureMode).toBe("stop-on-failure");
  expect(batch?.status).toBe("partial");
  expect(batch?.counts.failed).toBe(1);
  expect(batch?.counts.disabled).toBe(1);
  expect(batch?.runIds.length).toBe(2);
  expect(stored.batches[0].failureMode).toBe("stop-on-failure");
  expect(existsSync(skippedOutput)).toBe(false);
});

test("orders plugin batch queue by dependencies and skips failed dependents", async () => {
  const dependencyScript = path.join(tempRoot, "plugin-dependency-fails.js");
  const dependentScript = path.join(tempRoot, "plugin-dependent-should-skip.js");
  const dependentOutput = path.join(tempRoot, "plugin-dependent-output.txt");
  await writeFile(
    dependencyScript,
    "process.stderr.write('dependency failed'); process.exit(9);",
    "utf8"
  );
  await writeFile(
    dependentScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(dependentOutput)}, 'dependent-ran');`,
      "process.stdout.write('dependent should not run');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  await service.upsertPlugin(userId, {
    id: "plugin-dependency-fails",
    name: "Dependency Fails",
    scopes: ["process"],
    command: process.execPath,
    args: [dependencyScript],
    timeoutMs: 5000,
  });
  const saved = await service.upsertPlugin(userId, {
    id: "plugin-dependent-should-skip",
    name: "Dependent Should Skip",
    scopes: ["process"],
    dependencyIds: ["plugin-dependency-fails"],
    command: process.execPath,
    args: [dependentScript],
    timeoutMs: 5000,
  });
  for (const plugin of saved.plugins.items.filter((item) =>
    item.id.startsWith("plugin-dependency-") ||
    item.id.startsWith("plugin-dependent-")
  )) {
    await service.trustPlugin(userId, {
      pluginId: plugin.id,
      fingerprint: plugin.fingerprint,
    });
  }

  const ready = await service.snapshot(userId);
  const dependencyNode = ready.plugins.dependencyGraph.nodes.find(
    (node) => node.pluginId === "plugin-dependent-should-skip"
  );
  expect(dependencyNode?.dependencyIds).toEqual(["plugin-dependency-fails"]);
  expect(dependencyNode?.status).toBe("ready");
  expect(ready.plugins.dependencyGraph.edges).toContainEqual(
    expect.objectContaining({
      pluginId: "plugin-dependent-should-skip",
      dependencyId: "plugin-dependency-fails",
      status: "ready",
    })
  );
  const fingerprints = Object.fromEntries(
    ready.plugins.items
      .filter(
        (item) =>
          item.id === "plugin-dependent-should-skip" ||
          item.id === "plugin-dependency-fails"
      )
      .map((item) => [item.id, item.runOperation.fingerprint])
  );

  const result = await service.runPluginBatch(userId, {
    pluginIds: ["plugin-dependent-should-skip", "plugin-dependency-fails"],
    operationFingerprints: {
      "plugin-dependent-should-skip":
        fingerprints["plugin-dependent-should-skip"] ?? "",
      "plugin-dependency-fails": fingerprints["plugin-dependency-fails"] ?? "",
    },
    confirmation: "RUN PLUGIN BATCH",
  });
  const dependency = result.plugins.items.find(
    (item) => item.id === "plugin-dependency-fails"
  );
  const dependent = result.plugins.items.find(
    (item) => item.id === "plugin-dependent-should-skip"
  );
  const batch = result.plugins.recentBatches[0];
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(batch?.pluginIds).toEqual([
    "plugin-dependency-fails",
    "plugin-dependent-should-skip",
  ]);
  expect(batch?.diagnostics.join("\n")).toContain("dependency order");
  expect(dependency?.lastRun?.status).toBe("failed");
  expect(dependent?.lastRun?.status).toBe("disabled");
  expect(dependent?.lastRun?.diagnostics.join("\n")).toContain(
    "dependency plugin(s) did not complete successfully"
  );
  expect(batch?.status).toBe("partial");
  expect(batch?.counts.failed).toBe(1);
  expect(batch?.counts.disabled).toBe(1);
  expect(stored.plugins.find(
    (plugin: { id: string }) => plugin.id === "plugin-dependent-should-skip"
  )?.dependencyIds).toEqual(["plugin-dependency-fails"]);
  expect(existsSync(dependentOutput)).toBe(false);
});
test("persists and runs reusable plugin batch presets", async () => {
  const firstScript = path.join(tempRoot, "plugin-batch-preset-first.js");
  const secondScript = path.join(tempRoot, "plugin-batch-preset-second.js");
  await writeFile(
    firstScript,
    "process.stdout.write('preset first ok');",
    "utf8"
  );
  await writeFile(
    secondScript,
    "process.stdout.write('preset second ok');",
    "utf8"
  );

  const service = createService();
  await service.upsertPlugin(userId, {
    id: "plugin-batch-preset-first",
    name: "Preset First",
    scopes: ["process"],
    command: process.execPath,
    args: [firstScript],
    timeoutMs: 5000,
  });
  const savedPlugin = await service.upsertPlugin(userId, {
    id: "plugin-batch-preset-second",
    name: "Preset Second",
    scopes: ["process"],
    command: process.execPath,
    args: [secondScript],
    timeoutMs: 5000,
  });
  for (const plugin of savedPlugin.plugins.items.filter((item) =>
    item.id.startsWith("plugin-batch-preset-")
  )) {
    await service.trustPlugin(userId, {
      pluginId: plugin.id,
      fingerprint: plugin.fingerprint,
    });
  }

  const savedPreset = await service.upsertPluginBatchPreset(userId, {
    id: "preset-review-format",
    name: "Review and format",
    pluginIds: ["plugin-batch-preset-first", "plugin-batch-preset-second"],
    failureMode: "stop-on-failure",
  });
  const preset = savedPreset.plugins.batchPresets[0];
  expect(preset?.id).toBe("preset-review-format");
  expect(preset?.pluginNames).toEqual(["Preset First", "Preset Second"]);
  expect(preset?.failureMode).toBe("stop-on-failure");

  const ready = await service.snapshot(userId);
  const fingerprints = Object.fromEntries(
    ready.plugins.items
      .filter((item) => item.id.startsWith("plugin-batch-preset-"))
      .map((item) => [item.id, item.runOperation.fingerprint])
  );
  const run = await service.runPluginBatchPreset(userId, {
    presetId: "preset-review-format",
    operationFingerprints: {
      "plugin-batch-preset-first":
        fingerprints["plugin-batch-preset-first"] ?? "",
      "plugin-batch-preset-second":
        fingerprints["plugin-batch-preset-second"] ?? "",
    },
    confirmation: "RUN PLUGIN BATCH",
  });
  const runPreset = run.plugins.batchPresets.find(
    (item) => item.id === "preset-review-format"
  );
  const batch = run.plugins.recentBatches[0];
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(batch?.status).toBe("success");
  expect(batch?.failureMode).toBe("stop-on-failure");
  expect(batch?.counts.success).toBe(2);
  expect(runPreset?.lastRunBatchId).toBe(batch?.id);
  expect(stored.batchPresets[0].lastRunBatchId).toBe(batch?.id);

  const deleted = await service.deletePluginBatchPreset(userId, {
    presetId: "preset-review-format",
  });
  expect(deleted.plugins.batchPresets).toHaveLength(0);
});

test("runs due plugin batch schedules through guarded batch runner", async () => {
  const scheduledScript = path.join(tempRoot, "plugin-batch-scheduled.js");
  const staleScript = path.join(tempRoot, "plugin-batch-scheduled-stale.js");
  const scheduledOutput = path.join(tempRoot, "plugin-batch-scheduled.txt");
  const staleOutput = path.join(tempRoot, "plugin-batch-scheduled-stale.txt");
  await writeFile(
    scheduledScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(scheduledOutput)}, 'scheduled-ran');`,
      "process.stdout.write('scheduled batch ok');",
    ].join(" "),
    "utf8"
  );
  await writeFile(
    staleScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(staleOutput)}, 'stale-ran');`,
      "process.stdout.write('stale schedule should not run');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const savedPlugin = await service.upsertPlugin(userId, {
    id: "plugin-batch-scheduled",
    name: "Scheduled Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [scheduledScript],
    timeoutMs: 5000,
  });
  const plugin = savedPlugin.plugins.items.find(
    (item) => item.id === "plugin-batch-scheduled"
  );
  expect(plugin).toBeDefined();
  await service.trustPlugin(userId, {
    pluginId: "plugin-batch-scheduled",
    fingerprint: plugin?.fingerprint ?? "",
  });
  await service.upsertPluginBatchPreset(userId, {
    id: "preset-scheduled",
    name: "Scheduled preset",
    pluginIds: ["plugin-batch-scheduled"],
  });
  const ready = await service.snapshot(userId);
  const operationFingerprint =
    ready.plugins.items.find((item) => item.id === "plugin-batch-scheduled")
      ?.runOperation.fingerprint ?? "";
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const savedSchedule = await service.upsertPluginBatchSchedule(userId, {
    id: "schedule-scheduled",
    name: "Every minute scheduled preset",
    presetId: "preset-scheduled",
    intervalMs: 60_000,
    nextRunAt: dueAt,
    operationFingerprints: {
      "plugin-batch-scheduled": operationFingerprint,
    },
  });
  const schedule = savedSchedule.plugins.batchSchedules.find(
    (item) => item.id === "schedule-scheduled"
  );
  expect(schedule?.status).toBe("due");
  expect(schedule?.pluginNames).toEqual(["Scheduled Plugin"]);

  const run = await service.runDuePluginBatchSchedules(userId, {
    now: new Date().toISOString(),
  });
  const runSchedule = run.plugins.batchSchedules.find(
    (item) => item.id === "schedule-scheduled"
  );
  const batch = run.plugins.recentBatches[0];
  expect(batch?.status).toBe("success");
  expect(batch?.counts.success).toBe(1);
  expect(runSchedule?.lastRunBatchId).toBe(batch?.id);
  expect(runSchedule?.lastRunStatus).toBe("success");
  expect(runSchedule?.status).toBe("scheduled");
  expect(Date.parse(runSchedule?.nextRunAt ?? "")).toBeGreaterThan(Date.now());
  expect(await readFile(scheduledOutput, "utf8")).toBe("scheduled-ran");

  await service.upsertPlugin(userId, {
    id: "plugin-batch-scheduled",
    name: "Scheduled Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [staleScript],
    timeoutMs: 5000,
  });
  const staleSchedule = await service.upsertPluginBatchSchedule(userId, {
    id: "schedule-scheduled",
    name: "Every minute scheduled preset",
    presetId: "preset-scheduled",
    intervalMs: 60_000,
    nextRunAt: dueAt,
    operationFingerprints: {
      "plugin-batch-scheduled": operationFingerprint,
    },
  });
  expect(
    staleSchedule.plugins.batchSchedules.find(
      (item) => item.id === "schedule-scheduled"
    )?.status
  ).toBe("stale-fingerprint");

  const staleRun = await service.runDuePluginBatchSchedules(userId, {
    now: new Date().toISOString(),
    scheduleIds: ["schedule-scheduled"],
  });
  const staleBatch = staleRun.plugins.recentBatches[0];
  const staleRunRecord = staleRun.plugins.items.find(
    (item) => item.id === "plugin-batch-scheduled"
  )?.lastRun;
  expect(staleBatch?.status).toBe("blocked");
  expect(staleBatch?.counts.disabled).toBe(1);
  expect(staleRunRecord?.status).toBe("disabled");
  expect(staleRunRecord?.diagnostics.join("\n")).toContain(
    "operation fingerprint changed"
  );
  expect(existsSync(staleOutput)).toBe(false);

  const deleted = await service.deletePluginBatchSchedule(userId, {
    scheduleId: "schedule-scheduled",
  });
  expect(deleted.plugins.batchSchedules).toHaveLength(0);

  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );
  expect(stored.batchSchedules).toHaveLength(0);
});

test("dispatches due plugin batch schedules for project users", async () => {
  const scheduledScript = path.join(tempRoot, "plugin-batch-dispatch.js");
  const scheduledOutput = path.join(tempRoot, "plugin-batch-dispatch.txt");
  await writeFile(
    scheduledScript,
    [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(scheduledOutput)}, 'dispatch-ran');`,
      "process.stdout.write('dispatch batch ok');",
    ].join(" "),
    "utf8"
  );

  const service = createService();
  const savedPlugin = await service.upsertPlugin(userId, {
    id: "plugin-batch-dispatch",
    name: "Dispatch Plugin",
    scopes: ["process"],
    command: process.execPath,
    args: [scheduledScript],
    timeoutMs: 5000,
  });
  const plugin = savedPlugin.plugins.items.find(
    (item) => item.id === "plugin-batch-dispatch"
  );
  await service.trustPlugin(userId, {
    pluginId: "plugin-batch-dispatch",
    fingerprint: plugin?.fingerprint ?? "",
  });
  await service.upsertPluginBatchPreset(userId, {
    id: "preset-dispatch",
    name: "Dispatch preset",
    pluginIds: ["plugin-batch-dispatch"],
  });
  const ready = await service.snapshot(userId);
  const operationFingerprint =
    ready.plugins.items.find((item) => item.id === "plugin-batch-dispatch")
      ?.runOperation.fingerprint ?? "";
  await service.upsertPluginBatchSchedule(userId, {
    id: "schedule-dispatch",
    name: "Dispatch schedule",
    presetId: "preset-dispatch",
    intervalMs: 60_000,
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    operationFingerprints: {
      "plugin-batch-dispatch": operationFingerprint,
    },
  });

  const dispatch = await service.dispatchDuePluginBatchSchedules({
    userIds: [userId, userId, " "],
    now: new Date().toISOString(),
  });
  expect(dispatch).toEqual({
    users: 1,
    projects: 1,
    dueSchedules: 1,
    dispatchedSchedules: 1,
    failedProjects: 0,
  });

  const snapshot = await service.snapshot(userId);
  const schedule = snapshot.plugins.batchSchedules.find(
    (item) => item.id === "schedule-dispatch"
  );
  const batch = snapshot.plugins.recentBatches[0];
  expect(schedule?.lastRunStatus).toBe("success");
  expect(schedule?.lastRunBatchId).toBe(batch?.id);
  expect(schedule?.status).toBe("scheduled");
  expect(batch?.status).toBe("success");
  expect(batch?.counts.success).toBe(1);
  expect(await readFile(scheduledOutput, "utf8")).toBe("dispatch-ran");
});

test("installs signed plugin packages with signature verification", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1,
    publisher: "Unit Signed Publisher",
    publisherId: "unit.signed.publisher",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    plugin: {
      id: "signed-plugin",
      name: "Signed Plugin",
      description: "Signed executable plugin.",
      enabled: true,
      scopes: ["process"],
      envKeys: [],
      command: process.execPath,
      args: ["-e", "process.stdout.write('signed plugin ok')"],
      timeoutMs: 5000,
    },
  } as const;
  const signature = sign(
    null,
    Buffer.from(canonicalTestJson(payload as unknown as TestCanonicalJsonValue), "utf8"),
    privateKey
  ).toString("base64");
  const manifestPath = path.join(
    tempRoot,
    ".eragear",
    "plugin-packages",
    "signed-plugin.json"
  );
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...payload,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        signature,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const service = createService();
  const beforeInstall = await service.snapshot(userId);
  const catalogItem = beforeInstall.plugins.catalog.find(
    (item) => item.id === "signed-plugin"
  );
  expect(catalogItem?.status).toBe("installable");
  expect(catalogItem?.manifestPath).toBe(
    ".eragear/plugin-packages/signed-plugin.json"
  );
  expect(catalogItem?.signatureHash?.startsWith("sha256:")).toBe(true);
  expect(catalogItem?.publicKeyFingerprint?.startsWith("sha256:")).toBe(true);
  expect(catalogItem?.publisher).toBe("Unit Signed Publisher");
  expect(catalogItem?.publisherId).toBe("unit.signed.publisher");
  expect(catalogItem?.issuedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(catalogItem?.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  expect(catalogItem?.expiryStatus).toBe("valid");
  expect(catalogItem?.workspaceAccess).toBe("sandbox");
  expect(catalogItem?.diagnostics.join("\n")).toContain("ready to install");

  const installed = await service.installPluginPackage(userId, {
    manifestPath: ".eragear/plugin-packages/signed-plugin.json",
  });
  const plugin = installed.plugins.items.find((item) => item.id === "signed-plugin");
  const installedCatalogItem = installed.plugins.catalog.find(
    (item) => item.id === "signed-plugin"
  );
  const capability = installed.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.signed-plugin"
  );

  expect(plugin?.installSource).toBe("signed-package");
  expect(plugin?.publisher).toBe("Unit Signed Publisher");
  expect(plugin?.packagePublisherId).toBe("unit.signed.publisher");
  expect(plugin?.packageIssuedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(plugin?.packageExpiresAt).toBe("2099-01-01T00:00:00.000Z");
  expect(plugin?.packageExpiryStatus).toBe("valid");
  expect(plugin?.packageManifestPath).toBe(
    ".eragear/plugin-packages/signed-plugin.json"
  );
  expect(plugin?.packageSignatureHash?.startsWith("sha256:")).toBe(true);
  expect(plugin?.packagePublicKeyFingerprint?.startsWith("sha256:")).toBe(true);
  expect(plugin?.packageVerifiedAt).toBeDefined();
  expect(plugin?.trustStatus).toBe("trusted");
  expect(plugin?.trustedFingerprint).toBe(plugin?.fingerprint);
  expect(plugin?.permissionStatus).toBe("granted");
  expect(plugin?.grantedPermissionFingerprint).toBe(plugin?.permissionFingerprint);
  expect(plugin?.scopes).toEqual(["process"]);
  expect(installedCatalogItem?.status).toBe("installed");
  expect(installedCatalogItem?.installedPluginId).toBe("signed-plugin");
  expect(capability?.enabled).toBe(true);
  expect(capability?.tags).toContain("signed-package");

  const signedApprovalId = await approvePluginRunOperation(service, "signed-plugin");
  const ran = await service.runPlugin(userId, {
    pluginId: "signed-plugin",
    confirmation: "RUN PLUGIN signed-plugin",
    operationApprovalId: signedApprovalId,
  });
  const ranPlugin = ran.plugins.items.find((item) => item.id === "signed-plugin");
  expect(ranPlugin?.lastRun?.status).toBe("success");
  expect(ranPlugin?.lastRun?.stdout).toContain("signed plugin ok");

  const revalidated = await service.revalidatePluginPackage(userId, {
    pluginId: "signed-plugin",
  });
  const revalidatedPlugin = revalidated.plugins.items.find(
    (item) => item.id === "signed-plugin"
  );
  expect(revalidatedPlugin?.packageGovernanceStatus).toBe("verified");
  expect(revalidatedPlugin?.packageGovernanceDiagnostics?.join("\n")).toContain(
    "revalidated"
  );

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...payload,
        plugin: {
          ...payload.plugin,
          args: ["-e", "process.stdout.write('tampered signed plugin')"],
        },
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        signature,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const failedRevalidation = await service.revalidatePluginPackage(userId, {
    pluginId: "signed-plugin",
  });
  const failedGovernancePlugin = failedRevalidation.plugins.items.find(
    (item) => item.id === "signed-plugin"
  );
  const failedCapability = failedRevalidation.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.signed-plugin"
  );
  expect(failedGovernancePlugin?.packageGovernanceStatus).toBe(
    "verification-failed"
  );
  expect(
    failedGovernancePlugin?.packageGovernanceDiagnostics?.join("\n")
  ).toContain("signature verification failed");
  expect(failedCapability?.enabled).toBe(false);
  await expect(
    service.approvePluginRun(userId, {
      pluginId: "signed-plugin",
      operationFingerprint:
        failedGovernancePlugin?.runOperation.fingerprint ?? "",
    })
  ).rejects.toThrow("governance check failed");

  const pluginDocumentPath = path.join(tempRoot, ".eragear", "plugins.json");
  const pluginDocument = JSON.parse(await readFile(pluginDocumentPath, "utf8"));
  pluginDocument.plugins = pluginDocument.plugins.map((item: Record<string, unknown>) =>
    item.id === "signed-plugin"
      ? { ...item, packageExpiresAt: "2025-02-01T00:00:00.000Z" }
      : item
  );
  await writeFile(
    pluginDocumentPath,
    `${JSON.stringify(pluginDocument, null, 2)}\n`,
    "utf8"
  );
  const expiredInstalled = await service.snapshot(userId);
  const expiredInstalledPlugin = expiredInstalled.plugins.items.find(
    (item) => item.id === "signed-plugin"
  );
  const expiredCapability = expiredInstalled.capabilities.capabilities.find(
    (item) => item.id === "plugin.project.signed-plugin"
  );
  expect(expiredInstalledPlugin?.packageExpiryStatus).toBe("expired");
  expect(expiredCapability?.enabled).toBe(false);
  await expect(
    service.runPlugin(userId, {
      pluginId: "signed-plugin",
      confirmation: "RUN PLUGIN signed-plugin",
      operationApprovalId: "plugin-approval-unused",
    })
  ).rejects.toThrow("signature has expired");

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...payload,
        plugin: {
          ...payload.plugin,
          args: ["-e", "process.stdout.write('tampered signed plugin')"],
        },
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        signature,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await expect(
    service.installPluginPackage(userId, {
      manifestPath: ".eragear/plugin-packages/signed-plugin.json",
    })
  ).rejects.toThrow("signature verification failed");
  const tamperedCatalog = await service.snapshot(userId);
  const tamperedCatalogItem = tamperedCatalog.plugins.catalog.find(
    (item) => item.manifestPath === ".eragear/plugin-packages/signed-plugin.json"
  );
  expect(tamperedCatalogItem?.status).toBe("invalid");
  expect(tamperedCatalogItem?.diagnostics.join("\n")).toContain(
    "signature verification failed"
  );

  await expect(
    service.installPluginPackage(userId, {
      manifestPath: "../signed-plugin.json",
    })
  ).rejects.toThrow("inside the project root");

  const expiredPayload = {
    ...payload,
    publisherId: "unit.expired.publisher",
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-02-01T00:00:00.000Z",
    plugin: {
      ...payload.plugin,
      id: "expired-signed-plugin",
      name: "Expired Signed Plugin",
    },
  } as const;
  const expiredSignature = sign(
    null,
    Buffer.from(
      canonicalTestJson(expiredPayload as unknown as TestCanonicalJsonValue),
      "utf8"
    ),
    privateKey
  ).toString("base64");
  const expiredManifestPath = path.join(
    tempRoot,
    ".eragear",
    "plugin-packages",
    "expired-signed-plugin.json"
  );
  await writeFile(
    expiredManifestPath,
    `${JSON.stringify(
      {
        ...expiredPayload,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        signature: expiredSignature,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await expect(
    service.installPluginPackage(userId, {
      manifestPath: ".eragear/plugin-packages/expired-signed-plugin.json",
    })
  ).rejects.toThrow("signature has expired");
  const expiredCatalog = await service.snapshot(userId);
  const expiredCatalogItem = expiredCatalog.plugins.catalog.find(
    (item) => item.manifestPath === ".eragear/plugin-packages/expired-signed-plugin.json"
  );
  expect(expiredCatalogItem?.status).toBe("invalid");
  expect(expiredCatalogItem?.diagnostics.join("\n")).toContain(
    "signature has expired"
  );
});

test("installs signed plugin packages from a pinned remote registry", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1,
    publisher: "Registry Signed Publisher",
    publisherId: "registry.signed.publisher",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    plugin: {
      id: "registry-plugin",
      name: "Registry Plugin",
      description: "Registry delivered plugin.",
      enabled: true,
      scopes: ["process"],
      envKeys: [],
      command: process.execPath,
      args: ["-e", "process.stdout.write('registry plugin ok')"],
      timeoutMs: 5000,
    },
  } as const;
  const signature = sign(
    null,
    Buffer.from(canonicalTestJson(payload as unknown as TestCanonicalJsonValue), "utf8"),
    privateKey
  ).toString("base64");
  const signatureHash = `sha256:${createHash("sha256")
    .update(Buffer.from(signature, "base64"))
    .digest("hex")}`;
  const publicKeyFingerprint = `sha256:${createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")}`;
  const manifest = `${JSON.stringify(
    {
      ...payload,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      signature,
    },
    null,
    2
  )}\n`;
  const server = createServer((request, response) => {
    const baseUrl = `http://${request.headers.host ?? "127.0.0.1"}`;
    if (request.url === "/registry-plugin.json") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(manifest);
      return;
    }
    if (
      request.url === "/registry.json" ||
      request.url === "/bad-registry.json" ||
      request.url === "/bad-identity-registry.json" ||
      request.url === "/expired-registry.json" ||
      request.url === "/revoked-registry.json"
    ) {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            schemaVersion: 1,
            name: "Unit Registry",
            revokedSigners:
              request.url === "/revoked-registry.json"
                ? [
                    {
                      publicKeyFingerprint,
                      revokedAt: new Date().toISOString(),
                      reason: "direct feed revocation",
                    },
                  ]
                : [],
            packages: [
              {
                id: "registry-plugin",
                name: "Registry Plugin",
                publisher: "Registry Signed Publisher",
                publisherId:
                  request.url === "/bad-identity-registry.json"
                    ? "wrong.publisher"
                    : "registry.signed.publisher",
                issuedAt: "2026-01-01T00:00:00.000Z",
                expiresAt:
                  request.url === "/expired-registry.json"
                    ? "2025-02-01T00:00:00.000Z"
                    : "2099-01-01T00:00:00.000Z",
                manifestUrl: `${baseUrl}/registry-plugin.json`,
                signatureHash:
                  request.url === "/bad-registry.json"
                    ? "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                    : signatureHash,
                publicKeyFingerprint,
              },
            ],
          })
        );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const service = createService();
    const installed = await service.installPluginPackage(userId, {
      registryUrl: `${baseUrl}/registry.json`,
      packageId: "registry-plugin",
    });
    const plugin = installed.plugins.items.find((item) => item.id === "registry-plugin");
    const capability = installed.capabilities.capabilities.find(
      (item) => item.id === "plugin.project.registry-plugin"
    );

    expect(plugin?.installSource).toBe("signed-package");
    expect(plugin?.publisher).toBe("Registry Signed Publisher");
    expect(plugin?.packagePublisherId).toBe("registry.signed.publisher");
    expect(plugin?.packageIssuedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(plugin?.packageExpiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(plugin?.packageExpiryStatus).toBe("valid");
    expect(plugin?.packageManifestPath).toBe(`${baseUrl}/registry-plugin.json`);
    expect(plugin?.packageRegistryUrl).toBe(`${baseUrl}/registry.json`);
    expect(plugin?.packageRegistryName).toBe("Unit Registry");
    expect(plugin?.packageRegistryPackageId).toBe("registry-plugin");
    expect(plugin?.packageSignatureHash).toBe(signatureHash);
    expect(plugin?.packagePublicKeyFingerprint).toBe(publicKeyFingerprint);
    expect(plugin?.trustStatus).toBe("trusted");
    expect(plugin?.permissionStatus).toBe("granted");
    expect(capability?.enabled).toBe(true);
    expect(capability?.tags).toContain("signed-package");

    const registryApprovalId = await approvePluginRunOperation(
      service,
      "registry-plugin"
    );
    const ran = await service.runPlugin(userId, {
      pluginId: "registry-plugin",
      confirmation: "RUN PLUGIN registry-plugin",
      operationApprovalId: registryApprovalId,
    });
    const ranPlugin = ran.plugins.items.find((item) => item.id === "registry-plugin");
    expect(ranPlugin?.lastRun?.status).toBe("success");
    expect(ranPlugin?.lastRun?.stdout).toContain("registry plugin ok");

    await expect(
      service.installPluginPackage(userId, {
        registryUrl: `${baseUrl}/bad-registry.json`,
        packageId: "registry-plugin",
      })
    ).rejects.toThrow("signatureHash pin does not match");
    await expect(
      service.installPluginPackage(userId, {
        registryUrl: `${baseUrl}/bad-identity-registry.json`,
        packageId: "registry-plugin",
      })
    ).rejects.toThrow("publisherId");
    await expect(
      service.installPluginPackage(userId, {
        registryUrl: `${baseUrl}/expired-registry.json`,
        packageId: "registry-plugin",
      })
    ).rejects.toThrow("signature has expired");
    await expect(
      service.installPluginPackage(userId, {
        registryUrl: `${baseUrl}/revoked-registry.json`,
        packageId: "registry-plugin",
      })
    ).rejects.toThrow("revoked by registry feed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("manages trusted plugin registries with refresh and update state", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const buildPayload = (text: string) =>
    ({
      schemaVersion: 1,
      publisher: "Managed Registry Publisher",
      publisherId: "managed.registry.publisher",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      plugin: {
        id: "managed-registry-plugin",
        name: "Managed Registry Plugin",
        description: "Managed registry delivered plugin.",
        enabled: true,
        scopes: ["process"],
        envKeys: [],
        command: process.execPath,
        args: ["-e", `process.stdout.write('${text}')`],
        timeoutMs: 5000,
      },
    }) as const;
  const signManifest = (payload: ReturnType<typeof buildPayload>) => {
    const signature = sign(
      null,
      Buffer.from(canonicalTestJson(payload as unknown as TestCanonicalJsonValue), "utf8"),
      privateKey
    ).toString("base64");
    const manifest = `${JSON.stringify(
      {
        ...payload,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        signature,
      },
      null,
      2
    )}\n`;
    return {
      manifest,
      signatureHash: `sha256:${createHash("sha256")
        .update(Buffer.from(signature, "base64"))
        .digest("hex")}`,
      publicKeyFingerprint: `sha256:${createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex")}`,
    };
  };
  let current = signManifest(buildPayload("managed registry v1"));
  let registryFeedRevokedSigners: Array<{
    publicKeyFingerprint: string;
    revokedAt: string;
    reason: string;
  }> = [];
  const server = createServer((request, response) => {
    const baseUrl = `http://${request.headers.host ?? "127.0.0.1"}`;
    if (request.url === "/managed-plugin.json") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(current.manifest);
      return;
    }
    if (request.url === "/registry.json") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            schemaVersion: 1,
            name: "Managed Unit Registry",
            revokedSigners: registryFeedRevokedSigners,
            packages: [
              {
                id: "managed-registry-plugin",
                name: "Managed Registry Plugin",
                publisher: "Managed Registry Publisher",
                publisherId: "managed.registry.publisher",
                issuedAt: "2026-01-01T00:00:00.000Z",
                expiresAt: "2099-01-01T00:00:00.000Z",
                manifestUrl: `${baseUrl}/managed-plugin.json`,
                signatureHash: current.signatureHash,
                publicKeyFingerprint: current.publicKeyFingerprint,
              },
            ],
          })
        );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const registryUrl = `http://127.0.0.1:${address.port}/registry.json`;
  try {
    const service = createService();
    const saved = await service.upsertPluginRegistry(userId, {
      id: "managed-registry",
      name: "Managed Unit Registry",
      url: registryUrl,
    });
    const savedRegistry = saved.plugins.registries.find(
      (registry) => registry.id === "managed-registry"
    );
    expect(savedRegistry?.trustStatus).toBe("untrusted");
    expect(savedRegistry?.status).toBe("untrusted");
    await expect(
      service.refreshPluginRegistry(userId, {
        registryId: "managed-registry",
      })
    ).rejects.toThrow("must be trusted");

    const trusted = await service.trustPluginRegistry(userId, {
      registryId: "managed-registry",
      fingerprint: savedRegistry?.fingerprint ?? "",
    });
    expect(
      trusted.plugins.registries.find((registry) => registry.id === "managed-registry")
        ?.trustStatus
    ).toBe("trusted");

    const urlChanged = await service.upsertPluginRegistry(userId, {
      id: "managed-registry",
      name: "Managed Unit Registry",
      url: registryUrl.replace("/registry.json", "/registry-rotated.json"),
    });
    const changedRegistry = urlChanged.plugins.registries.find(
      (registry) => registry.id === "managed-registry"
    );
    expect(changedRegistry?.trustStatus).toBe("untrusted");
    expect(changedRegistry?.trustedFingerprint).toBeUndefined();
    expect(changedRegistry?.packages).toHaveLength(0);
    await expect(
      service.refreshPluginRegistry(userId, {
        registryId: "managed-registry",
      })
    ).rejects.toThrow("must be trusted");

    const resetUrl = await service.upsertPluginRegistry(userId, {
      id: "managed-registry",
      name: "Managed Unit Registry",
      url: registryUrl,
    });
    const resetRegistry = resetUrl.plugins.registries.find(
      (registry) => registry.id === "managed-registry"
    );
    expect(resetRegistry?.trustStatus).toBe("untrusted");
    const retrustedOriginal = await service.trustPluginRegistry(userId, {
      registryId: "managed-registry",
      fingerprint: resetRegistry?.fingerprint ?? "",
    });
    expect(
      retrustedOriginal.plugins.registries.find(
        (registry) => registry.id === "managed-registry"
      )?.trustStatus
    ).toBe("trusted");

    const refreshed = await service.refreshPluginRegistry(userId, {
      registryId: "managed-registry",
    });
    const refreshedRegistry = refreshed.plugins.registries.find(
      (registry) => registry.id === "managed-registry"
    );
    const installablePackage = refreshedRegistry?.packages.find(
      (item) => item.id === "managed-registry-plugin"
    );
    expect(refreshedRegistry?.status).toBe("ready");
    expect(installablePackage?.status).toBe("installable");
    expect(installablePackage?.signingStatus).toBe("trusted");
    expect(installablePackage?.publisherId).toBe("managed.registry.publisher");
    expect(installablePackage?.issuedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(installablePackage?.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(installablePackage?.expiryStatus).toBe("valid");
    expect(installablePackage?.signatureHash).toBe(current.signatureHash);

    const trustRevoked = await service.revokePluginRegistryTrust(userId, {
      registryId: "managed-registry",
    });
    expect(
      trustRevoked.plugins.registries.find(
        (registry) => registry.id === "managed-registry"
      )?.trustStatus
    ).toBe("untrusted");
    await expect(
      service.refreshPluginRegistry(userId, {
        registryId: "managed-registry",
      })
    ).rejects.toThrow("must be trusted");
    const retrusted = await service.trustPluginRegistry(userId, {
      registryId: "managed-registry",
      fingerprint:
        trustRevoked.plugins.registries.find(
          (registry) => registry.id === "managed-registry"
        )?.fingerprint ?? "",
    });
    expect(
      retrusted.plugins.registries.find(
        (registry) => registry.id === "managed-registry"
      )?.trustStatus
    ).toBe("trusted");

    const signerRevoked = await service.revokePluginRegistrySigner(userId, {
      registryId: "managed-registry",
      publicKeyFingerprint: current.publicKeyFingerprint,
      reason: "unit revocation",
    });
    const revokedPackage = signerRevoked.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(revokedPackage?.status).toBe("revoked");
    expect(revokedPackage?.signingStatus).toBe("revoked");
    expect(revokedPackage?.revocationReason).toBe("unit revocation");
    await expect(
      service.installPluginRegistryPackage(userId, {
        registryId: "managed-registry",
        packageId: "managed-registry-plugin",
      })
    ).rejects.toThrow("signer is revoked");
    const signerRestored = await service.restorePluginRegistrySigner(userId, {
      registryId: "managed-registry",
      publicKeyFingerprint: current.publicKeyFingerprint,
    });
    const restoredPackage = signerRestored.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(restoredPackage?.status).toBe("installable");
    expect(restoredPackage?.signingStatus).toBe("trusted");

    registryFeedRevokedSigners = [
      {
        publicKeyFingerprint: current.publicKeyFingerprint,
        revokedAt: new Date().toISOString(),
        reason: "feed revocation",
      },
    ];
    const feedRevoked = await service.refreshPluginRegistry(userId, {
      registryId: "managed-registry",
    });
    const feedRevokedPackage = feedRevoked.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(feedRevokedPackage?.status).toBe("revoked");
    expect(feedRevokedPackage?.signingStatus).toBe("revoked");
    expect(feedRevokedPackage?.revocationSource).toBe("registry");
    await expect(
      service.installPluginRegistryPackage(userId, {
        registryId: "managed-registry",
        packageId: "managed-registry-plugin",
      })
    ).rejects.toThrow("signer is revoked");
    await expect(
      service.restorePluginRegistrySigner(userId, {
        registryId: "managed-registry",
        publicKeyFingerprint: current.publicKeyFingerprint,
      })
    ).rejects.toThrow("registry feed");
    registryFeedRevokedSigners = [];
    const feedCleared = await service.refreshPluginRegistry(userId, {
      registryId: "managed-registry",
    });
    const feedClearedPackage = feedCleared.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(feedClearedPackage?.status).toBe("installable");
    expect(feedClearedPackage?.signingStatus).toBe("trusted");

    const installed = await service.installPluginRegistryPackage(userId, {
      registryId: "managed-registry",
      packageId: "managed-registry-plugin",
    });
    const installedPlugin = installed.plugins.items.find(
      (item) => item.id === "managed-registry-plugin"
    );
    const installedPackage = installed.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(installedPlugin?.packageRegistryName).toBe("Managed Unit Registry");
    expect(installedPlugin?.packageRegistryPackageId).toBe("managed-registry-plugin");
    expect(installedPlugin?.packagePublisherId).toBe("managed.registry.publisher");
    expect(installedPlugin?.packageExpiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(installedPlugin?.packageExpiryStatus).toBe("valid");
    expect(installedPlugin?.packageSignatureHash).toBe(current.signatureHash);
    expect(installedPackage?.status).toBe("installed");

    current = signManifest(buildPayload("managed registry v2"));
    const updateReady = await service.refreshPluginRegistry(userId, {
      registryId: "managed-registry",
    });
    const updatePackage = updateReady.plugins.registries
      .find((registry) => registry.id === "managed-registry")
      ?.packages.find((item) => item.id === "managed-registry-plugin");
    expect(updatePackage?.status).toBe("update-available");
    expect(updatePackage?.signatureHash).toBe(current.signatureHash);

    const updated = await service.installPluginRegistryPackage(userId, {
      registryId: "managed-registry",
      packageId: "managed-registry-plugin",
    });
    const updatedPlugin = updated.plugins.items.find(
      (item) => item.id === "managed-registry-plugin"
    );
    expect(updatedPlugin?.packageSignatureHash).toBe(current.signatureHash);
    const managedApprovalId = await approvePluginRunOperation(
      service,
      "managed-registry-plugin"
    );
    const ran = await service.runPlugin(userId, {
      pluginId: "managed-registry-plugin",
      confirmation: "RUN PLUGIN managed-registry-plugin",
      operationApprovalId: managedApprovalId,
    });
    expect(
      ran.plugins.items.find((item) => item.id === "managed-registry-plugin")?.lastRun
        ?.stdout
    ).toContain("managed registry v2");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("audits project-root plugin workspace changes with checkpoint safety", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "WORK.md"), "initial\n", "utf8");
  await writeFile(path.join(tempRoot, "DIRTY.md"), "clean\n", "utf8");
  await execFileAsync("git", ["add", "WORK.md", "DIRTY.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "DIRTY.md"), "dirty before plugin\n", "utf8");

  const service = createService();
  const saved = await service.upsertPlugin(userId, {
    id: "plugin-workspace-audit",
    name: "Workspace Audit Plugin",
    scopes: ["process", "project-root"],
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.appendFileSync(path.join(process.env.ERAGEAR_PROJECT_ROOT, 'WORK.md'), 'plugin wrote\\n');",
        "process.stdout.write('workspace write ok');",
      ].join(" "),
    ],
    timeoutMs: 5000,
  });
  const plugin = saved.plugins.items.find(
    (item) => item.id === "plugin-workspace-audit"
  );
  await service.trustPlugin(userId, {
    pluginId: "plugin-workspace-audit",
    fingerprint: plugin?.fingerprint ?? "",
  });

  const approvalId = await approvePluginRunOperation(
    service,
    "plugin-workspace-audit"
  );
  const ran = await service.runPlugin(userId, {
    pluginId: "plugin-workspace-audit",
    confirmation: "RUN PLUGIN plugin-workspace-audit",
    operationApprovalId: approvalId,
  });
  const ranPlugin = ran.plugins.items.find(
    (item) => item.id === "plugin-workspace-audit"
  );
  const run = ranPlugin?.lastRun;

  expect(run?.status).toBe("success");
  expect(run?.stdout).toContain("workspace write ok");
  expect(run?.workspaceStatusBefore).toEqual([" M DIRTY.md"]);
  expect(run?.workspaceStatusAfter).toEqual([" M DIRTY.md", " M WORK.md"]);
  expect(run?.workspaceChangedFiles).toEqual(["WORK.md"]);
  expect(run?.preRunCheckpointId).toBeDefined();
  expect(run?.postRunCheckpointId).toBeDefined();
  expect(run?.diagnostics.join("\n")).toContain(
    "Plugin pre-run safety checkpoint created"
  );
  expect(run?.diagnostics.join("\n")).toContain(
    "Plugin post-run change checkpoint created"
  );

  const preRunCheckpoint = ran.checkpoints.items.find(
    (item) => item.id === run?.preRunCheckpointId
  );
  const postRunCheckpoint = ran.checkpoints.items.find(
    (item) => item.id === run?.postRunCheckpointId
  );
  expect(preRunCheckpoint?.restoreMode).toBe("apply-patch");
  expect(preRunCheckpoint?.changedFiles).toEqual(["DIRTY.md"]);
  expect(postRunCheckpoint?.restoreMode).toBe("reverse-patch");
  expect(postRunCheckpoint?.changedFiles).toEqual(["DIRTY.md", "WORK.md"]);

  const preview = await service.previewCheckpoint(userId, {
    checkpointId: postRunCheckpoint?.id ?? "",
  });
  const workDiff = preview.diffFiles.find((file) => file.path === "WORK.md");
  expect(workDiff?.hunks.some((hunk) =>
    hunk.rows.some((row) => row.kind === "add" && row.newText === "plugin wrote")
  )).toBe(true);

  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );
  expect(stored.runs[0].preRunCheckpointId).toBe(run?.preRunCheckpointId);
  expect(stored.runs[0].postRunCheckpointId).toBe(run?.postRunCheckpointId);
  expect(stored.runs[0].workspaceChangedFiles).toEqual(["WORK.md"]);
});

test("discovers invokable skills and output styles with persisted disabled state", async () => {
  await mkdir(path.join(tempRoot, ".eragear", "skills", "reviewer"), {
    recursive: true,
  });
  await mkdir(path.join(tempRoot, ".eragear", "output-styles"), {
    recursive: true,
  });
  await writeFile(
    path.join(tempRoot, ".eragear", "skills", "reviewer", "SKILL.md"),
    "---\nname: Reviewer Skill\ndescription: Review with project standards\n---\n# Reviewer Skill\nUse project review standards.\n",
    "utf8"
  );
  await writeFile(
    path.join(tempRoot, ".eragear", "output-styles", "concise.md"),
    "---\nname: Concise\ndescription: Answer briefly\n---\n# Concise\nPrefer short, direct answers.\n",
    "utf8"
  );

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const skill = snapshot.skills.find((item) => item.name === "Reviewer Skill");
  const style = snapshot.outputStyles.find((item) => item.name === "Concise");
  const skillCapability = snapshot.capabilities.capabilities.find(
    (item) => item.id === skill?.id
  );
  const styleCapability = snapshot.capabilities.capabilities.find(
    (item) => item.id === style?.id
  );

  expect(skill?.enabled).toBe(true);
  expect(skill?.prompt).toContain("Use project review standards.");
  expect(skillCapability?.kind).toBe("skill");
  expect(style?.enabled).toBe(true);
  expect(style?.prompt).toContain("Prefer short, direct answers.");
  expect(styleCapability?.kind).toBe("output-style");

  const updated = await service.updateCapabilityState(userId, {
    capabilityId: skill?.id ?? "",
    enabled: false,
  });
  const disabledSkill = updated.skills.find((item) => item.id === skill?.id);
  const state = JSON.parse(
    await readFile(
      path.join(tempRoot, ".eragear", "capabilities-state.json"),
      "utf8"
    )
  );

  expect(disabledSkill?.enabled).toBe(false);
  expect(state.capabilities[skill?.id ?? ""]?.enabled).toBe(false);
});

test("discovers project subagents as invokable capabilities", async () => {
  await mkdir(path.join(tempRoot, ".eragear", "subagents"), {
    recursive: true,
  });
  await writeFile(
    path.join(tempRoot, ".eragear", "subagents", "reviewer.md"),
    "---\nname: reviewer\ndescription: Review the active diff\ntools: read, git\n---\n# Reviewer\nCheck regressions.\n",
    "utf8"
  );

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const subagent = snapshot.subagents.find((item) => item.name === "reviewer");
  const capability = snapshot.capabilities.capabilities.find(
    (item) => item.id === subagent?.id
  );

  expect(subagent).toBeDefined();
  expect(subagent?.enabled).toBe(true);
  expect(subagent?.prompt).toContain("Check regressions.");
  expect(subagent?.tools).toEqual(["read", "git"]);
  expect(capability?.kind).toBe("subagent");
  expect(capability?.enabled).toBe(true);
});

test("initializes stdio MCP entries and discovers tools/resources", async () => {
  const service = createService();
  const mcpScript = await writeMcpFixture();

  const updated = await service.upsertMcpServer(userId, {
    name: "Local runtime probe",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    enabled: true,
  });
  const server = updated.mcp.servers.find(
    (item) => item.name === "Local runtime probe"
  );

  expect(server).toBeDefined();
  expect(server?.health).toBe("available");
  expect(server?.protocol.status).toBe("initialized");
  expect(server?.protocol.serverName).toBe("fake-mcp");
  expect(server?.tools.map((tool) => tool.name)).toEqual(["read_repo"]);
  expect(server?.resources.map((resource) => resource.name)).toEqual(["README"]);
  expect(server?.latencyMs).toBeGreaterThanOrEqual(0);
  expect(server?.probe.status).toBe("success");
  expect(server?.probe.retryable).toBe(true);
  expect(server?.probe.failedStepCount).toBe(0);
  expect(server?.probe.steps.map((step) => step.step)).toEqual(
    expect.arrayContaining([
      "resolve",
      "spawn",
      "initialize",
      "initialized",
      "tools/list",
      "resources/list",
    ])
  );
  expect(server?.diagnostics.join("\n")).toContain("MCP initialize succeeded");
  expect(server?.notificationHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "probe",
        method: "notifications/message",
      }),
    ])
  );

  if (!server?.id) {
    throw new Error("Expected MCP server id.");
  }
  const probed = await service.probeMcpServer(userId, { id: server.id });
  const probedServer = probed.mcp.servers.find(
    (item) => item.name === "Local runtime probe"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
  );
  expect(probedServer?.probeHistory).toHaveLength(1);
  expect(probedServer?.probeHistory[0]?.status).toBe("success");
  expect(probedServer?.probeHistory[0]?.protocolStatus).toBe("initialized");
  expect(probedServer?.probeHistory[0]?.steps.map((step) => step.step)).toEqual(
    expect.arrayContaining(["initialize", "tools/list", "resources/list"])
  );
  expect(probedServer?.notificationHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "probe",
        method: "notifications/message",
      }),
    ])
  );
  expect(stored.servers[0].probeHistory[0].status).toBe("success");
  expect(stored.servers[0].notificationHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "probe",
        method: "notifications/message",
      }),
    ])
  );
});

test("invokes MCP tools and reads MCP resources over stdio", async () => {
  const service = createService();
  const mcpScript = await writeMcpFixture();
  const updated = await service.upsertMcpServer(userId, {
    id: "stdio-invoke",
    name: "Stdio invocation probe",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    env: {
      UNIT_MCP_SECRET: "unit-mcp-secret-value",
    },
    enabled: true,
  });
  const server = updated.mcp.servers.find(
    (item) => item.name === "Stdio invocation probe"
  );
  if (!server) {
    throw new Error("Expected stdio invocation MCP server.");
  }
  expect(server.trustStatus).toBe("untrusted");
  expect(server.fingerprint.startsWith("sha256:")).toBe(true);
  const trusted = await service.trustMcpServer(userId, {
    serverId: "stdio-invoke",
    fingerprint: server.fingerprint,
  });
  const trustedServer = trusted.mcp.servers.find(
    (item) => item.id === "stdio-invoke"
  );
  expect(trustedServer?.trustStatus).toBe("trusted");
  expect(trustedServer?.trustedFingerprint).toBe(trustedServer?.fingerprint);

  const toolResult = await service.invokeMcpTool(userId, {
    serverId: "stdio-invoke",
    toolName: "read_repo",
    arguments: { path: "README.md" },
  });
  const resourceResult = await service.readMcpResource(userId, {
    serverId: "stdio-invoke",
    uri: "file:///README.md",
  });
  const snapshot = await service.snapshot(userId);
  const auditedServer = snapshot.mcp.servers.find(
    (item) => item.id === "stdio-invoke"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
  );
  const storedInvocationHistory = stored.servers.find(
    (item: { id?: string }) => item.id === "stdio-invoke"
  )?.invocationHistory;
  const storedNotificationHistory = stored.servers.find(
    (item: { id?: string }) => item.id === "stdio-invoke"
  )?.notificationHistory;

  expect(server.tools.map((tool) => tool.name)).toEqual(["read_repo"]);
  expect(toolResult.status).toBe("success");
  expect(toolResult.method).toBe("tools/call");
  expect(toolResult.target).toBe("read_repo");
  expect(toolResult.resultText).toContain("tool read_repo path=README.md");
  expect(toolResult.resultText).toContain("[redacted]");
  expect(toolResult.resultText).not.toContain("unit-mcp-secret-value");
  expect(toolResult.content[0]?.type).toBe("text");
  expect(resourceResult.status).toBe("success");
  expect(resourceResult.method).toBe("resources/read");
  expect(resourceResult.target).toBe("file:///README.md");
  expect(resourceResult.content[0]?.uri).toBe("file:///README.md");
  expect(resourceResult.resultText).toContain("resource file:///README.md");
  expect(auditedServer?.invocationHistory).toHaveLength(2);
  expect(auditedServer?.invocationHistory[0]?.method).toBe("resources/read");
  expect(auditedServer?.invocationHistory[1]?.method).toBe("tools/call");
  expect(auditedServer?.invocationHistory[1]?.resultText).not.toContain(
    "unit-mcp-secret-value"
  );
  expect(auditedServer?.notificationHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "probe",
        method: "notifications/message",
      }),
      expect.objectContaining({
        source: "invocation",
        method: "notifications/progress",
      }),
    ])
  );
  expect(JSON.stringify(auditedServer?.notificationHistory)).toContain(
    "[redacted]"
  );
  expect(JSON.stringify(auditedServer?.notificationHistory)).not.toContain(
    "unit-mcp-secret-value"
  );
  expect(storedInvocationHistory).toHaveLength(2);
  expect(JSON.stringify(storedInvocationHistory)).not.toContain(
    "unit-mcp-secret-value"
  );
  expect(storedNotificationHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "invocation",
        method: "notifications/progress",
      }),
    ])
  );
  expect(JSON.stringify(storedNotificationHistory)).toContain("[redacted]");
  expect(JSON.stringify(storedNotificationHistory)).not.toContain(
    "unit-mcp-secret-value"
  );
});

test("summarizes MCP agent session routing policy without exposing secrets", async () => {
  const service = createService();
  const mcpScript = await writeMcpFixture();

  const untrustedSnapshot = await service.upsertMcpServer(userId, {
    id: "route-stdio",
    name: "Route Stdio MCP",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    env: {
      UNIT_MCP_SECRET: "route-secret-value",
    },
    enabled: true,
  });
  const untrustedServer = untrustedSnapshot.mcp.servers.find(
    (item) => item.id === "route-stdio"
  );
  const untrustedRoute = untrustedSnapshot.mcp.agentRouting.routes.find(
    (item) => item.serverId === "route-stdio"
  );

  expect(untrustedRoute?.status).toBe("blocked");
  expect(untrustedRoute?.reason).toContain("must be trusted");
  expect(JSON.stringify(untrustedSnapshot.mcp.agentRouting)).not.toContain(
    "route-secret-value"
  );
  if (!untrustedServer) {
    throw new Error("Expected route stdio MCP server.");
  }

  const trustedSnapshot = await service.trustMcpServer(userId, {
    serverId: "route-stdio",
    fingerprint: untrustedServer.fingerprint,
  });
  const trustedRoute = trustedSnapshot.mcp.agentRouting.routes.find(
    (item) => item.serverId === "route-stdio"
  );

  expect(trustedRoute?.status).toBe("injectable");
  expect(trustedRoute?.brokerMode).toBe("stdio-proxy");
  expect(trustedRoute?.agentSupport).toBe("not-required");
  expect(trustedSnapshot.mcp.agentRouting.injectableCount).toBe(1);
  await writeFile(
    path.join(tempRoot, ".eragear", "mcp-agent-audit.jsonl"),
    `${JSON.stringify({
      id: "agent-audit-1",
      serverId: "route-stdio",
      serverName: "Route Stdio MCP",
      method: "tools/call",
      target: "read_repo",
      status: "success",
      startedAt: "2026-06-11T15:00:00.000Z",
      finishedAt: "2026-06-11T15:00:00.010Z",
      durationMs: 10,
      resultText: "broker ok [redacted]",
      source: "agent-broker",
    })}\n`,
    "utf8"
  );
  const auditedSnapshot = await service.snapshot(userId);
  const auditedRoute = auditedSnapshot.mcp.agentRouting.routes.find(
    (item) => item.serverId === "route-stdio"
  );
  expect(auditedRoute?.agentInvocationCount).toBe(1);
  expect(auditedRoute?.lastAgentInvocation?.target).toBe("read_repo");
  expect(auditedRoute?.lastAgentInvocation?.status).toBe("success");
  expect(auditedSnapshot.mcp.agentRouting.agentInvocationHistory[0]?.source).toBe(
    "agent-broker"
  );

  const secret = "Bearer route-http-secret";
  const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
  process.env.ERAGEAR_TEST_MCP_AUTH = secret;
  const fixture = await startHttpMcpFixture(secret);
  try {
    const remoteSnapshot = await service.upsertMcpServer(userId, {
      id: "route-http",
      name: "Route HTTP MCP",
      transport: "streamable-http",
      url: fixture.url,
      headerEnv: {
        Authorization: "ERAGEAR_TEST_MCP_AUTH",
      },
      enabled: true,
    });
    const remoteServer = remoteSnapshot.mcp.servers.find(
      (item) => item.id === "route-http"
    );
    if (!remoteServer) {
      throw new Error("Expected route HTTP MCP server.");
    }
    const trustedRemoteSnapshot = await service.trustMcpServer(userId, {
      serverId: "route-http",
      fingerprint: remoteServer.fingerprint,
    });
    const remoteRoute = trustedRemoteSnapshot.mcp.agentRouting.routes.find(
      (item) => item.serverId === "route-http"
    );

    expect(remoteRoute?.status).toBe("injectable");
    expect(remoteRoute?.brokerMode).toBe("stdio-proxy");
    expect(remoteRoute?.requiresAgentCapability).toBeUndefined();
    expect(remoteRoute?.agentSupport).toBe("not-required");
    expect(remoteRoute?.diagnostics.join(" ")).toContain(
      "Remote MCP headers are resolved inside the broker"
    );
    expect(remoteRoute?.headerEnv).toEqual([
      {
        header: "Authorization",
        envKey: "ERAGEAR_TEST_MCP_AUTH",
        present: true,
      },
    ]);
    expect(JSON.stringify(trustedRemoteSnapshot.mcp.agentRouting)).not.toContain(
      secret
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ERAGEAR_TEST_MCP_AUTH;
    } else {
      process.env.ERAGEAR_TEST_MCP_AUTH = previous;
    }
    await fixture.close();
  }
});

test("enforces MCP invocation trust fingerprints", async () => {
  const service = createService();
  const mcpScript = await writeMcpFixture();
  const updated = await service.upsertMcpServer(userId, {
    id: "stdio-trust",
    name: "Stdio trust probe",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    env: {
      UNIT_MCP_SECRET: "unit-mcp-secret-value",
    },
    enabled: true,
  });
  const server = updated.mcp.servers.find((item) => item.id === "stdio-trust");
  if (!server) {
    throw new Error("Expected trust probe MCP server.");
  }

  expect(server.trustStatus).toBe("untrusted");
  expect(server.fingerprint.startsWith("sha256:")).toBe(true);
  const initialCapability = updated.capabilities.capabilities.find(
    (item) => item.id === "mcp.project.stdio-trust"
  );
  expect(initialCapability?.enabled).toBe(false);

  const blocked = await service.invokeMcpTool(userId, {
    serverId: "stdio-trust",
    toolName: "read_repo",
    arguments: { path: "README.md" },
  });
  expect(blocked.status).toBe("failed");
  expect(blocked.diagnostics.join("\n")).toContain(
    "MCP invocation blocked by trust policy"
  );

  await expect(
    service.trustMcpServer(userId, {
      serverId: "stdio-trust",
      fingerprint: "sha256:not-current",
    })
  ).rejects.toThrow("fingerprint changed");

  const trusted = await service.trustMcpServer(userId, {
    serverId: "stdio-trust",
    fingerprint: server.fingerprint,
  });
  const trustedServer = trusted.mcp.servers.find(
    (item) => item.id === "stdio-trust"
  );
  const trustedCapability = trusted.capabilities.capabilities.find(
    (item) => item.id === "mcp.project.stdio-trust"
  );
  expect(trustedServer?.trustStatus).toBe("trusted");
  expect(trustedServer?.trustedFingerprint).toBe(trustedServer?.fingerprint);
  expect(trustedCapability?.enabled).toBe(true);

  const changed = await service.upsertMcpServer(userId, {
    id: "stdio-trust",
    name: "Stdio trust probe",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    env: {
      UNIT_MCP_SECRET: "rotated-mcp-secret-value",
    },
    enabled: true,
  });
  const changedServer = changed.mcp.servers.find(
    (item) => item.id === "stdio-trust"
  );
  expect(changedServer?.trustStatus).toBe("changed");
  expect(changedServer?.trustedFingerprint).toBe(server.fingerprint);
  expect(changedServer?.fingerprint).not.toBe(server.fingerprint);
  const changedCapability = changed.capabilities.capabilities.find(
    (item) => item.id === "mcp.project.stdio-trust"
  );
  expect(changedCapability?.enabled).toBe(false);

  const changedBlocked = await service.readMcpResource(userId, {
    serverId: "stdio-trust",
    uri: "file:///README.md",
  });
  expect(changedBlocked.status).toBe("failed");
  expect(changedBlocked.diagnostics.join("\n")).toContain(
    "configuration changed after trust approval"
  );

  const snapshot = await service.snapshot(userId);
  const auditedServer = snapshot.mcp.servers.find(
    (item) => item.id === "stdio-trust"
  );
  expect(auditedServer?.invocationHistory).toHaveLength(2);
  expect(auditedServer?.invocationHistory[0]?.status).toBe("failed");
  expect(auditedServer?.invocationHistory[1]?.status).toBe("failed");
  expect(JSON.stringify(auditedServer?.invocationHistory)).not.toContain(
    "unit-mcp-secret-value"
  );
  expect(JSON.stringify(auditedServer?.invocationHistory)).not.toContain(
    "rotated-mcp-secret-value"
  );
});

test("initializes SSE MCP entries through a message endpoint", async () => {
  const service = createService();
  const fixture = await startSseMcpFixture();
  try {
    const updated = await service.upsertMcpServer(userId, {
      name: "SSE runtime probe",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.name === "SSE runtime probe"
    );
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
    );

    expect(server).toBeDefined();
    expect(server?.health).toBe("available");
    expect(server?.protocol.status).toBe("initialized");
    expect(server?.protocol.serverName).toBe("fake-sse-mcp");
    expect(server?.messageEndpoint).toBe(fixture.messageEndpoint);
    expect(server?.tools.map((tool) => tool.name)).toEqual(["sse_read_repo"]);
    expect(server?.resources.map((resource) => resource.name)).toEqual(["SSE"]);
    expect(server?.probe.status).toBe("success");
    expect(server?.probe.steps.map((step) => step.step)).toEqual(
      expect.arrayContaining([
        "header-policy",
        "endpoint",
        "stream-open",
        "initialize",
        "initialized",
        "tools/list",
        "resources/list",
      ])
    );
    expect(server?.diagnostics.join("\n")).toContain(
      "MCP initialize succeeded over SSE message endpoint"
    );
    expect(server?.notificationHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "probe",
          method: "notifications/message",
        }),
      ])
    );
    expect(stored.servers[0].messageEndpoint).toBe(fixture.messageEndpoint);
  } finally {
    await fixture.close();
  }
});

test("reconnects SSE MCP probes and replays pending discovery requests", async () => {
  const service = createService();
  const fixture = await startSseMcpFixture({
    closeFirstStreamOnFirstRequest: true,
  });
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-reconnect",
      name: "SSE reconnect probe",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.id === "sse-reconnect"
    );

    expect(server?.health).toBe("available");
    expect(server?.protocol.status).toBe("initialized");
    expect(server?.tools.map((tool) => tool.name)).toEqual(["sse_read_repo"]);
    expect(fixture.requestCounts.initialize).toBe(2);
    expect(server?.probe.steps.map((step) => step.step)).toEqual(
      expect.arrayContaining(["stream-open", "stream-reconnect", "initialize"])
    );
    expect(server?.diagnostics.join("\n")).toContain(
      "MCP SSE stream closed before protocol discovery completed; reconnecting"
    );

  } finally {
    await fixture.close();
  }
});

test("invokes SSE MCP tools with header env redaction", async () => {
  const service = createService();
  const secret = "Bearer sse-mcp-secret-value";
  const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
  process.env.ERAGEAR_TEST_MCP_AUTH = secret;
  const fixture = await startSseMcpFixture();
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-invoke",
      name: "SSE invocation probe",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      headerEnv: {
        Authorization: "ERAGEAR_TEST_MCP_AUTH",
      },
      enabled: true,
    });
    const server = updated.mcp.servers.find((item) => item.id === "sse-invoke");
    if (!server) {
      throw new Error("Expected SSE invocation MCP server.");
    }
    await service.trustMcpServer(userId, {
      serverId: "sse-invoke",
      fingerprint: server.fingerprint,
    });

    const result = await service.invokeMcpTool(userId, {
      serverId: "sse-invoke",
      toolName: "sse_read_repo",
      arguments: { path: "SSE.md" },
    });

    expect(result.status).toBe("success");
    expect(result.resultText).toContain("sse tool sse_read_repo");
    expect(result.resultText).toContain("[redacted]");
    expect(result.resultText).not.toContain(secret);
    expect(result.diagnostics.join("\n")).not.toContain(secret);
    const snapshot = await service.snapshot(userId);
    const auditedServer = snapshot.mcp.servers.find(
      (item) => item.id === "sse-invoke"
    );
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
    );
    const storedInvocationHistory = stored.servers.find(
      (item: { id?: string }) => item.id === "sse-invoke"
    )?.invocationHistory;
    const storedNotificationHistory = stored.servers.find(
      (item: { id?: string }) => item.id === "sse-invoke"
    )?.notificationHistory;
    expect(auditedServer?.invocationHistory[0]?.method).toBe("tools/call");
    expect(auditedServer?.invocationHistory[0]?.resultText).toContain("[redacted]");
    expect(auditedServer?.invocationHistory[0]?.resultText).not.toContain(secret);
    expect(auditedServer?.notificationHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "probe",
          method: "notifications/message",
        }),
        expect.objectContaining({
          source: "invocation",
          method: "notifications/message",
        }),
      ])
    );
    expect(JSON.stringify(auditedServer?.notificationHistory)).toContain(
      "[redacted]"
    );
    expect(JSON.stringify(auditedServer?.notificationHistory)).not.toContain(secret);
    expect(JSON.stringify(storedInvocationHistory)).not.toContain(secret);
    expect(storedNotificationHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "invocation",
          method: "notifications/message",
        }),
      ])
    );
    expect(JSON.stringify(storedNotificationHistory)).toContain("[redacted]");
    expect(JSON.stringify(storedNotificationHistory)).not.toContain(secret);
  } finally {
    if (previous === undefined) {
      delete process.env.ERAGEAR_TEST_MCP_AUTH;
    } else {
      process.env.ERAGEAR_TEST_MCP_AUTH = previous;
    }
    await fixture.close();
  }
});

test("watches SSE MCP notifications with reconnect and redacted history", async () => {
  const service = createService();
  const secret = "Bearer sse-monitor-secret-value";
  const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
  process.env.ERAGEAR_TEST_MCP_AUTH = secret;
  const fixture = await startSseMcpFixture();
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-monitor",
      name: "SSE notification monitor",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      headerEnv: {
        Authorization: "ERAGEAR_TEST_MCP_AUTH",
      },
      enabled: true,
    });
    const server = updated.mcp.servers.find((item) => item.id === "sse-monitor");
    if (!server) {
      throw new Error("Expected SSE notification monitor server.");
    }
    await service.trustMcpServer(userId, {
      serverId: "sse-monitor",
      fingerprint: server.fingerprint,
    });
    const beforeInitializeCount = fixture.requestCounts.initialize ?? 0;
    fixture.closeNextStreamOnFirstRequest();

    const watched = await service.watchMcpNotifications(userId, {
      serverId: "sse-monitor",
      durationMs: 350,
    });
    const monitoredServer = watched.mcp.servers.find(
      (item) => item.id === "sse-monitor"
    );
    const run = monitoredServer?.notificationMonitorHistory[0];
    const serializedServer = JSON.stringify(monitoredServer);
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
    );
    const storedServer = stored.servers.find(
      (item: { id?: string }) => item.id === "sse-monitor"
    );

    expect(run?.status).toBe("success");
    expect(run?.reconnectCount).toBe(1);
    expect(run?.streamOpenCount).toBeGreaterThanOrEqual(2);
    expect(run?.notificationCount).toBeGreaterThanOrEqual(1);
    expect(fixture.requestCounts.initialize ?? 0).toBeGreaterThan(
      beforeInitializeCount
    );
    expect(run?.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "monitor",
          method: "notifications/message",
        }),
      ])
    );
    expect(monitoredServer?.notificationHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "monitor",
          method: "notifications/message",
        }),
      ])
    );
    expect(serializedServer).toContain("[redacted]");
    expect(serializedServer).not.toContain(secret);
    expect(JSON.stringify(storedServer)).not.toContain(secret);
    expect(storedServer.notificationMonitorHistory[0].reconnectCount).toBe(1);
  } finally {
    if (previous === undefined) {
      delete process.env.ERAGEAR_TEST_MCP_AUTH;
    } else {
      process.env.ERAGEAR_TEST_MCP_AUTH = previous;
    }
    await fixture.close();
  }
});

test("configures remote MCP controls and applies them to SSE notification watches", async () => {
  const service = createService();
  const fixture = await startSseMcpFixture();
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-remote-controls",
      name: "SSE remote controls",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    );
    if (!server) {
      throw new Error("Expected SSE remote controls server.");
    }
    expect(server.remoteControls.mode).toBe("default");

    const trusted = await service.trustMcpServer(userId, {
      serverId: "sse-remote-controls",
      fingerprint: server.fingerprint,
    });
    const trustedServer = trusted.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    );
    if (!trustedServer) {
      throw new Error("Expected trusted SSE remote controls server.");
    }

    const configured = await service.configureMcpRemoteControls(userId, {
      serverId: "sse-remote-controls",
      fingerprint: trustedServer.fingerprint,
      requestTimeoutMs: 2500,
      reconnectAttempts: 0,
      notificationWatchMs: 400,
    });
    const configuredServer = configured.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    );
    if (!configuredServer) {
      throw new Error("Expected configured SSE remote controls server.");
    }
    expect(configuredServer.remoteControls).toMatchObject({
      mode: "custom",
      requestTimeoutMs: 2500,
      reconnectAttempts: 0,
      notificationWatchMs: 400,
    });
    expect(configuredServer.trustStatus).toBe("changed");

    const storedConfigured = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
    );
    expect(
      storedConfigured.servers.find(
        (item: { id?: string }) => item.id === "sse-remote-controls"
      )?.remoteControls
    ).toEqual({
      requestTimeoutMs: 2500,
      reconnectAttempts: 0,
      notificationWatchMs: 400,
    });

    const retrusted = await service.trustMcpServer(userId, {
      serverId: "sse-remote-controls",
      fingerprint: configuredServer.fingerprint,
    });
    const zeroReconnectServer = retrusted.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    );
    fixture.closeNextStreamOnFirstRequest();
    const failedWatch = await service.watchMcpNotifications(userId, {
      serverId: "sse-remote-controls",
    });
    const failedRun = failedWatch.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    )?.notificationMonitorHistory[0];
    expect(zeroReconnectServer?.trustStatus).toBe("trusted");
    expect(failedRun?.requestedDurationMs).toBe(400);
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.reconnectCount).toBe(0);
    expect(failedRun?.diagnostics.join("\n")).toContain(
      "timeout 2500ms, reconnects 0, watch 400ms"
    );

    const reconnectConfigured = await service.configureMcpRemoteControls(userId, {
      serverId: "sse-remote-controls",
      fingerprint:
        failedWatch.mcp.servers.find((item) => item.id === "sse-remote-controls")
          ?.fingerprint ?? "",
      requestTimeoutMs: 2500,
      reconnectAttempts: 2,
      notificationWatchMs: 400,
    });
    const reconnectServer = reconnectConfigured.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    );
    if (!reconnectServer) {
      throw new Error("Expected reconnect-configured SSE remote controls server.");
    }
    expect(reconnectServer.trustStatus).toBe("changed");

    await service.trustMcpServer(userId, {
      serverId: "sse-remote-controls",
      fingerprint: reconnectServer.fingerprint,
    });
    fixture.closeNextStreamOnFirstRequest();
    const recoveredWatch = await service.watchMcpNotifications(userId, {
      serverId: "sse-remote-controls",
    });
    const recoveredRun = recoveredWatch.mcp.servers.find(
      (item) => item.id === "sse-remote-controls"
    )?.notificationMonitorHistory[0];
    expect(recoveredRun?.requestedDurationMs).toBe(400);
    expect(recoveredRun?.status).toBe("success");
    expect(recoveredRun?.reconnectCount).toBe(1);
    expect(recoveredRun?.streamOpenCount).toBeGreaterThanOrEqual(2);
    expect(recoveredRun?.diagnostics.join("\n")).toContain(
      "timeout 2500ms, reconnects 2, watch 400ms"
    );
  } finally {
    await fixture.close();
  }
});

test("reconnects SSE MCP resource invocations and replays safe requests", async () => {
  const service = createService();
  const fixture = await startSseMcpFixture({
    closeOnceOnMethod: "resources/read",
  });
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-resource-reconnect",
      name: "SSE resource reconnect probe",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.id === "sse-resource-reconnect"
    );
    if (!server) {
      throw new Error("Expected SSE resource reconnect MCP server.");
    }
    await service.trustMcpServer(userId, {
      serverId: "sse-resource-reconnect",
      fingerprint: server.fingerprint,
    });

    const result = await service.readMcpResource(userId, {
      serverId: "sse-resource-reconnect",
      uri: "file:///SSE.md",
    });

    expect(result.status).toBe("success");
    expect(result.resultText).toContain("sse resource file:///SSE.md");
    expect(fixture.requestCounts["resources/read"]).toBe(2);
    expect(result.diagnostics.join("\n")).toContain(
      "MCP SSE invocation stream closed before completion; reconnecting"
    );
    expect(result.diagnostics.join("\n")).toContain(
      "MCP SSE invocation stream reconnected with HTTP 200"
    );
  } finally {
    await fixture.close();
  }
});

test("does not replay SSE MCP tool calls after stream loss", async () => {
  const service = createService();
  const fixture = await startSseMcpFixture({
    closeOnceOnMethod: "tools/call",
  });
  try {
    const updated = await service.upsertMcpServer(userId, {
      id: "sse-tool-no-replay",
      name: "SSE tool no replay probe",
      transport: "sse",
      url: fixture.streamUrl,
      messageEndpoint: fixture.messageEndpoint,
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.id === "sse-tool-no-replay"
    );
    if (!server) {
      throw new Error("Expected SSE tool no-replay MCP server.");
    }
    await service.trustMcpServer(userId, {
      serverId: "sse-tool-no-replay",
      fingerprint: server.fingerprint,
    });

    const result = await service.invokeMcpTool(userId, {
      serverId: "sse-tool-no-replay",
      toolName: "sse_read_repo",
      arguments: { path: "SSE.md" },
    });

    expect(result.status).toBe("failed");
    expect(fixture.requestCounts["tools/call"]).toBe(1);
    expect(result.diagnostics.join("\n")).toContain(
      "side-effecting tools/call"
    );
    expect(result.diagnostics.join("\n")).toContain(
      "not replaying automatically"
    );
  } finally {
    await fixture.close();
  }
});

test("initializes HTTP MCP entries with header env policy and redaction", async () => {
  const service = createService();
  const secret = "Bearer mcp-secret-header-value";
  const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
  process.env.ERAGEAR_TEST_MCP_AUTH = secret;
  const fixture = await startHttpMcpFixture(secret);
  try {
    const updated = await service.upsertMcpServer(userId, {
      name: "HTTP runtime probe",
      transport: "streamable-http",
      url: fixture.url,
      headerEnv: {
        Authorization: "ERAGEAR_TEST_MCP_AUTH",
      },
      enabled: true,
    });
    const server = updated.mcp.servers.find(
      (item) => item.name === "HTTP runtime probe"
    );
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "mcp-servers.json"), "utf8")
    );

    expect(server?.health).toBe("available");
    expect(server?.protocol.status).toBe("initialized");
    expect(server?.protocol.serverName).toBe("fake-http-mcp");
    expect(server?.headerEnv).toEqual([
      { header: "Authorization", envKey: "ERAGEAR_TEST_MCP_AUTH", present: true },
    ]);
    expect(server?.tools.map((tool) => tool.name)).toEqual(["http_read_repo"]);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored.servers[0].headerEnv.Authorization).toBe("ERAGEAR_TEST_MCP_AUTH");

    delete process.env.ERAGEAR_TEST_MCP_AUTH;
    const missing = await service.upsertMcpServer(userId, {
      id: "missing-http-mcp",
      name: "Missing HTTP runtime probe",
      transport: "streamable-http",
      url: fixture.url,
      headerEnv: {
        Authorization: "ERAGEAR_TEST_MCP_AUTH",
      },
      enabled: true,
    });
    const missingServer = missing.mcp.servers.find(
      (item) => item.name === "Missing HTTP runtime probe"
    );
    expect(missingServer?.health).toBe("unavailable");
    expect(missingServer?.protocol.error).toContain("missing env keys");
    expect(missingServer?.probe.status).toBe("failed");
    expect(missingServer?.probe.failedStepCount).toBe(1);
    expect(missingServer?.probe.steps[0]?.step).toBe("header-policy");
    expect(missingServer?.probe.steps[0]?.status).toBe("failed");
    expect(missingServer?.diagnostics.join("\n")).toContain("ERAGEAR_TEST_MCP_AUTH");
    expect(missingServer?.diagnostics.join("\n")).not.toContain(secret);

    await expect(
      service.upsertMcpServer(userId, {
        name: "Unsafe literal header",
        transport: "streamable-http",
        url: fixture.url,
        headers: {
          Authorization: `Bearer ${secret}`,
        },
        enabled: true,
      })
    ).rejects.toThrow("literal secret headers");
  } finally {
    if (previous === undefined) {
      delete process.env.ERAGEAR_TEST_MCP_AUTH;
    } else {
      process.env.ERAGEAR_TEST_MCP_AUTH = previous;
    }
    await fixture.close();
  }
});

test("surfaces exact MCP protocol errors in diagnostics", async () => {
  const service = createService();
  const mcpScript = await writeMcpFixture({ toolsError: true });

  const updated = await service.upsertMcpServer(userId, {
    name: "Protocol error probe",
    transport: "stdio",
    command: process.execPath,
    args: [mcpScript],
    enabled: true,
  });
  const server = updated.mcp.servers.find(
    (item) => item.name === "Protocol error probe"
  );

  expect(server?.health).toBe("available");
  expect(server?.protocol.status).toBe("initialized");
  expect(server?.tools).toEqual([]);
  expect(server?.probe.status).toBe("success");
  expect(server?.probe.failedStepCount).toBe(1);
  expect(
    server?.probe.steps.some(
      (step) =>
        step.step === "tools/list" &&
        step.status === "failed" &&
        step.error?.includes("no tools here")
    )
  ).toBe(true);
  expect(server?.diagnostics.join("\n")).toContain(
    "MCP tools/list failed: JSON-RPC error -32601: no tools here"
  );
});

test("tests provider readiness and persists redacted health metadata", async () => {
  const providerScript = await writeProviderFixture();
  const agent: AgentConfig = {
    id: "agent-1",
    userId,
    name: "Runtime Agent",
    type: "opencode",
    command: process.execPath,
    args: [providerScript],
    env: { TEST_SECRET_KEY: "redacted-by-contract" },
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const service = createService([agent]);

  const updated = await service.testProvider(userId, {
    providerId: "provider.agent.agent-1",
  });
  const provider = updated.providers.find(
    (item) => item.id === "provider.agent.agent-1"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "provider-health.json"), "utf8")
  );

  expect(provider?.status).toBe("ready");
  expect(provider?.cliStatus).toBe("ok");
  expect(provider?.authStatus).toBe("ok");
  expect(provider?.modelStatus).toBe("ok");
  expect(provider?.modelList).toEqual(["model-alpha", "model-beta"]);
  expect(provider?.redactedEnvKeys).toEqual(["TEST_SECRET_KEY"]);
  expect(provider?.version).toBe("fake-provider 1.2.3");
  expect(stored.providers["provider.agent.agent-1"].status).toBe("ready");
  expect(JSON.stringify(stored)).not.toContain("redacted-by-contract");
});

test("uses Codex doctor JSON for provider auth and model readiness", async () => {
  const providerScript = await writeCodexProviderFixture();
  const agent: AgentConfig = {
    id: "codex-agent",
    userId,
    name: "Codex Runtime",
    type: "codex",
    command: process.execPath,
    args: [providerScript],
    env: { CODEX_TEST_SECRET: "codex-secret-value" },
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const service = createService([agent]);

  const updated = await service.testProvider(userId, {
    providerId: "provider.agent.codex-agent",
  });
  const provider = updated.providers.find(
    (item) => item.id === "provider.agent.codex-agent"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "provider-health.json"), "utf8")
  );

  expect(provider?.status).toBe("ready");
  expect(provider?.cliStatus).toBe("ok");
  expect(provider?.authStatus).toBe("ok");
  expect(provider?.modelStatus).toBe("ok");
  expect(provider?.readiness).toBe("ready");
  expect(provider?.modelList).toEqual(["gpt-test"]);
  expect(provider?.diagnostics.join("\n")).toContain(
    "Codex doctor overall status: ok."
  );
  expect(provider?.diagnostics.join("\n")).toContain(
    "Codex doctor auth.credentials: ok."
  );
  expect(provider?.diagnostics.join("\n")).not.toContain(
    "Codex doctor output was not valid JSON."
  );
  expect(provider?.diagnostics.join("\n")).not.toContain("codex-secret-value");
  expect(stored.providers["provider.agent.codex-agent"].status).toBe("ready");
  expect(JSON.stringify(stored)).not.toContain("codex-secret-value");
});

test("uses Claude and Gemini provider probes with remediation guidance", async () => {
  const claudeScript = await writeClaudeProviderFixture();
  const geminiScript = await writeGeminiProviderFixture();
  const agents: AgentConfig[] = [
    {
      id: "claude-agent",
      userId,
      name: "Claude Runtime",
      type: "claude",
      command: process.execPath,
      args: [claudeScript],
      env: { CLAUDE_TEST_SECRET: "claude-secret-value" },
      projectId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "gemini-agent",
      userId,
      name: "Gemini Runtime",
      type: "gemini",
      command: process.execPath,
      args: [geminiScript],
      env: { GEMINI_TEST_SECRET: "gemini-secret-value" },
      projectId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  const service = createService(agents);

  await service.testProvider(userId, {
    providerId: "provider.agent.claude-agent",
  });
  const updated = await service.testProvider(userId, {
    providerId: "provider.agent.gemini-agent",
  });
  const claude = updated.providers.find(
    (item) => item.id === "provider.agent.claude-agent"
  );
  const gemini = updated.providers.find(
    (item) => item.id === "provider.agent.gemini-agent"
  );
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "provider-health.json"), "utf8")
  );

  expect(claude?.status).toBe("ready");
  expect(claude?.authStatus).toBe("ok");
  expect(claude?.modelStatus).toBe("ok");
  expect(claude?.modelList).toEqual([
    "claude-sonnet-smoke",
    "claude-opus-smoke",
  ]);
  expect(claude?.diagnostics.join("\n")).toContain(
    "claude doctor overall status: ok."
  );
  expect(claude?.remediation).toEqual([
    "Provider is ready; no remediation required.",
  ]);

  expect(gemini?.status).toBe("ready");
  expect(gemini?.authStatus).toBe("ok");
  expect(gemini?.modelStatus).toBe("ok");
  expect(gemini?.modelList).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
  expect(gemini?.diagnostics.join("\n")).toContain(
    "Provider doctor probe failed; falling back to CLI probes."
  );
  expect(gemini?.remediation).toEqual([
    "Provider is ready; no remediation required.",
  ]);

  expect(stored.providers["provider.agent.claude-agent"].remediation).toEqual(
    ["Provider is ready; no remediation required."]
  );
  expect(stored.providers["provider.agent.gemini-agent"].remediation).toEqual(
    ["Provider is ready; no remediation required."]
  );
  expect(JSON.stringify(stored)).not.toContain("claude-secret-value");
  expect(JSON.stringify(stored)).not.toContain("gemini-secret-value");
});

test("selects a readiness-probed provider model as the runtime default model", async () => {
  const providerScript = await writeProviderFixture();
  const agent: AgentConfig = {
    id: "agent-select",
    userId,
    name: "Selectable Runtime Agent",
    type: "opencode",
    command: process.execPath,
    args: [providerScript],
    env: { TEST_SECRET_KEY: "redacted-by-contract" },
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const service = createService([agent]);

  await service.testProvider(userId, {
    providerId: "provider.agent.agent-select",
  });
  const selected = await service.selectProviderModel(userId, {
    providerId: "provider.agent.agent-select",
    modelId: "model-beta",
  });
  const provider = selected.providers.find(
    (item) => item.id === "provider.agent.agent-select"
  );

  expect(selected.runtime.defaultModel).toBe("model-beta");
  expect(selected.runtime.defaultModelProviderId).toBe(
    "provider.agent.agent-select"
  );
  expect(selected.runtime.defaultModelStatus).toBe("selected");
  expect(provider?.selectedModel).toBe("model-beta");
  expect(provider?.modelListSource).toBe("readiness-probe");
  expect(JSON.stringify(selected)).not.toContain("redacted-by-contract");

  const cleared = await service.clearProviderModel(userId);
  const clearedProvider = cleared.providers.find(
    (item) => item.id === "provider.agent.agent-select"
  );

  expect(cleared.runtime.defaultModel).toBe("");
  expect(cleared.runtime.defaultModelProviderId).toBeNull();
  expect(cleared.runtime.defaultModelStatus).toBe("not-set");
  expect(clearedProvider?.selectedModel).toBeUndefined();
});

test("rejects provider model selection before a successful model readiness probe", async () => {
  const agent: AgentConfig = {
    id: "agent-fallback",
    userId,
    name: "Fallback Runtime Agent",
    type: "opencode",
    command: process.execPath,
    args: ["--version"],
    env: {},
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const service = createService([agent]);
  const snapshot = await service.snapshot(userId);
  const provider = snapshot.providers.find(
    (item) => item.id === "provider.agent.agent-fallback"
  );

  expect(provider?.modelList).toEqual(["agent-configured"]);
  expect(provider?.modelListSource).toBe("fallback");
  await expect(
    service.selectProviderModel(userId, {
      providerId: "provider.agent.agent-fallback",
      modelId: "agent-configured",
    })
  ).rejects.toThrow("successful readiness probe");
});

test("surfaces active session model switching options from config state", async () => {
  const activeSession = {
    id: "chat-model-1",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    sessionId: "agent-session-model-1",
    chatStatus: "ready",
    subscriberCount: 1,
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    proc: { pid: 12345 },
    agentInfo: { name: "Model Agent" },
    supportsModelSwitching: false,
    models: {
      currentModelId: "legacy-model",
      availableModels: [
        { modelId: "legacy-model", name: "Legacy Model" },
      ],
    },
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "model-a",
        options: [
          { value: "model-a", name: "Model A" },
          { value: "model-b", name: "Model B", description: "Beta model" },
        ],
      },
    ],
  } as unknown as RuntimeSession;
  const service = createService([], { activeSessions: [activeSession] });

  const snapshot = await service.snapshot(userId);
  const session = snapshot.sessions.active.find(
    (item) => item.id === "chat-model-1"
  );

  expect(session?.model.currentModelId).toBe("model-a");
  expect(session?.model.supportsSwitching).toBe(true);
  expect(session?.model.source).toBe("config-option");
  expect(session?.model.availableModels).toEqual([
    { modelId: "model-a", name: "Model A" },
    { modelId: "model-b", name: "Model B", description: "Beta model" },
  ]);
  expect(session?.model.diagnostics.join("\n")).toContain(
    "session config options"
  );
});

test("surfaces redacted ACP activity for owned chats", async () => {
  const storedSession: StoredSession = {
    id: "chat-owned",
    userId,
    name: "Owned ACP Session",
    projectId: "project-1",
    projectRoot: tempRoot,
    sessionId: "agent-session-owned",
    agentName: "OpenCode",
    status: "running",
    createdAt: 1000,
    lastActiveAt: 1200,
    messages: [],
    messageCount: 0,
  };
  const service = createService([], {
    storedSessions: { "chat-owned": storedSession },
    logEntries: [
      {
        id: "log-setup",
        timestamp: 1200,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "initialize",
          rawPayloadLength: 256,
          rawPayload: '{"secret":"do-not-show"}',
          token: "do-not-show",
        },
      },
      {
        id: "log-update",
        timestamp: 1100,
        level: "debug",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-owned",
        meta: {
          rawType: "agent_message_chunk",
          rawPayloadLength: 64,
          rawPayload: '{"content":"do-not-show"}',
        },
      },
      {
        id: "log-other-user",
        timestamp: 1000,
        level: "error",
        userId: "other-user",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-other",
        meta: {
          rawType: "tool_call",
          rawPayloadLength: 32,
        },
      },
      {
        id: "log-unrelated",
        timestamp: 900,
        level: "info",
        source: "console",
        message: "SQLite worker started",
      },
    ],
  });

  const snapshot = await service.snapshot(userId);

  expect(snapshot.acpActivity.entries.map((entry) => entry.id)).toEqual([
    "log-setup",
    "log-update",
  ]);
  expect(snapshot.acpActivity.stats.total).toBe(2);
  expect(snapshot.acpActivity.stats.chatCount).toBe(1);
  expect(snapshot.acpActivity.stats.levels.info).toBe(1);
  expect(snapshot.acpActivity.stats.levels.debug).toBe(1);
  expect(snapshot.acpActivity.stats.kinds.initialize).toBe(1);
  expect(snapshot.acpActivity.stats.kinds.agent_message_chunk).toBe(1);
  expect(snapshot.acpActivity.correlations).toHaveLength(1);
  expect(snapshot.acpActivity.correlations[0]?.chatId).toBe("chat-owned");
  expect(snapshot.acpActivity.correlations[0]?.eventCount).toBe(2);
  expect(snapshot.acpActivity.correlations[0]?.kinds.initialize).toBe(1);
  const setupEntry = snapshot.acpActivity.entries[0];
  if (!setupEntry) {
    throw new Error("Expected setup ACP activity entry");
  }
  expect(setupEntry.payloadBytes).toBe(256);
  expect(setupEntry.metadata).toEqual({
    step: "initialize",
  });
  expect(JSON.stringify(snapshot.acpActivity)).not.toContain("do-not-show");
  expect(JSON.stringify(snapshot.acpActivity)).not.toContain("rawPayload");
  expect(Object.keys(setupEntry.metadata)).not.toContain("rawPayload");
  expect(Object.keys(setupEntry.metadata)).not.toContain("rawPayloadLength");
  expect(Object.keys(setupEntry.metadata)).not.toContain("token");
  expect(snapshot.acpActivity.diagnostics.join("\n")).toContain("hidden");
});

test("builds redacted cross-session ACP activity timeline", async () => {
  const storedSessions: Record<string, StoredSession> = {
    "chat-a": {
      id: "chat-a",
      userId,
      projectId: "project-1",
      projectRoot: tempRoot,
      agentId: "agent-1",
      agentName: "OpenCode",
      status: "running",
      createdAt: 1000,
      lastActiveAt: 1200,
      messages: [],
      messageCount: 0,
    },
    "chat-b": {
      id: "chat-b",
      userId,
      projectId: "project-1",
      projectRoot: tempRoot,
      agentId: "agent-1",
      agentName: "OpenCode",
      status: "running",
      createdAt: 1050,
      lastActiveAt: 1300,
      messages: [],
      messageCount: 0,
    },
  };
  const service = createService([], {
    storedSessions,
    logEntries: [
      {
        id: "a-init",
        timestamp: 1000,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-a",
        meta: {
          step: "initialize",
          sessionId: "agent-session-a",
          rawPayload: '{"token":"do-not-show"}',
          rawPayloadLength: 16,
        },
      },
      {
        id: "b-init",
        timestamp: 1100,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-b",
        meta: {
          step: "initialize",
          sessionId: "agent-session-b",
          rawPayloadLength: 24,
        },
      },
      {
        id: "a-turn",
        timestamp: 1200,
        level: "debug",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-a",
        meta: {
          rawType: "agent_message_chunk",
          sessionId: "agent-session-a",
          turnId: "turn-a",
          rawPayload: '{"secret":"do-not-show"}',
        },
      },
      {
        id: "b-tool",
        timestamp: 1300,
        level: "warn",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-b",
        meta: {
          rawType: "tool_call",
          sessionId: "agent-session-b",
          toolCallId: "tool-b",
          token: "do-not-show",
        },
      },
      {
        id: "other-user",
        timestamp: 1250,
        level: "error",
        source: "acp",
        userId: "other-user",
        message: "ACP session update",
        chatId: "chat-c",
        meta: {
          rawType: "tool_call",
        },
      },
    ],
  });

  const snapshot = await service.snapshot(userId);
  const timeline = snapshot.acpActivity.timeline;

  expect(timeline.lanes.map((lane) => lane.chatId)).toEqual(["chat-b", "chat-a"]);
  expect(timeline.lanes[0]?.eventCount).toBe(2);
  expect(timeline.lanes[0]?.latestKind).toBe("tool_call");
  expect(timeline.lanes[1]?.eventCount).toBe(2);
  expect(timeline.frames.map((frame) => frame.id)).toEqual([
    "a-init",
    "b-init",
    "a-turn",
    "b-tool",
  ]);
  expect(timeline.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4]);
  expect(timeline.frames.map((frame) => frame.offsetMs)).toEqual([
    0,
    100,
    200,
    300,
  ]);
  expect(timeline.frames[2]?.laneKey).toBe("chat:chat-a");
  expect(timeline.frames[2]?.correlationKey).toBe("turn:turn-a");
  expect(timeline.transitions).toHaveLength(3);
  expect(timeline.transitions[0]).toMatchObject({
    fromChatId: "chat-a",
    toChatId: "chat-b",
    fromKind: "initialize",
    toKind: "initialize",
  });
  expect(timeline.spanMs).toBe(300);
  expect(timeline.omittedFrames).toBe(0);
  expect(JSON.stringify(timeline)).not.toContain("do-not-show");
  expect(JSON.stringify(timeline)).not.toContain("rawPayload");
  expect(JSON.stringify(timeline)).not.toContain("token");
  expect(JSON.stringify(timeline)).not.toContain("other-user");

  const workspaceReplay = await service.replayAcpActivity(userId, { limit: 10 });
  expect(workspaceReplay.filters).toEqual({ limit: 10 });
  expect(workspaceReplay.frames.map((frame) => frame.chatId)).toEqual([
    "chat-a",
    "chat-b",
    "chat-a",
    "chat-b",
  ]);
  expect(JSON.stringify(workspaceReplay)).not.toContain("rawPayload");
});

test("derives ACP stream retry controls and causality diagnostics", async () => {
  const now = Date.now();
  const storedSession: StoredSession = {
    id: "chat-owned",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "running",
    createdAt: now - 6_000,
    lastActiveAt: now - 1_000,
    messages: [],
    messageCount: 0,
  };
  const service = createService([], {
    storedSessions: { "chat-owned": storedSession },
    logEntries: [
      {
        id: "stream-init",
        timestamp: now - 5_000,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "initialize",
          sessionId: "agent-session-owned",
          rawPayload: '{"secret":"do-not-show"}',
          rawPayloadLength: 64,
        },
      },
      {
        id: "stream-chunk",
        timestamp: now - 2_500,
        level: "debug",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-owned",
        meta: {
          rawType: "agent_message_chunk",
          sessionId: "agent-session-owned",
          rawPayload: '{"token":"do-not-show"}',
          rawPayloadLength: 24,
        },
      },
      {
        id: "stream-orphan",
        timestamp: now - 1_000,
        level: "info",
        source: "acp",
        message: "ACP transport heartbeat",
        meta: {
          step: "stream-heartbeat",
          rawPayload: '{"token":"do-not-show"}',
        },
      },
    ],
  });

  const snapshot = await service.snapshot(userId);
  const stream = snapshot.acpActivity.stream;

  expect(stream.status).toBe("attention");
  expect(stream.retryEligible).toBe(true);
  expect(stream.retryDelayMs).toBe(1000);
  expect(stream.retryMaxAttempts).toBe(5);
  expect(stream.staleAfterMs).toBe(60_000);
  expect(stream.heartbeatWindowMs).toBe(30_000);
  expect(stream.latestTimestamp).toBe(now - 1_000);
  expect(stream.rootCount).toBe(1);
  expect(stream.correlatedFrameCount).toBe(2);
  expect(stream.orphanFrameCount).toBe(1);
  expect(stream.longestChainLength).toBe(2);
  expect(stream.maxSilenceMs).toBe(2_500);
  expect(stream.averageDeltaMs).toBe(2_000);
  expect(stream.gaps).toHaveLength(1);
  expect(stream.gaps[0]).toMatchObject({
    deltaMs: 2_500,
    fromFrameId: "stream-init",
    toFrameId: "stream-chunk",
    fromKind: "initialize",
    toKind: "agent_message_chunk",
    fromChatId: "chat-owned",
    toChatId: "chat-owned",
  });
  const sessionChain = stream.chains.find(
    (chain) => chain.key === "agent-session:agent-session-owned"
  );
  expect(sessionChain).toMatchObject({
    key: "agent-session:agent-session-owned",
    eventCount: 2,
    chatId: "chat-owned",
    sessionId: "agent-session-owned",
  });
  expect(stream.diagnostics.join("\n")).toContain("Retry Stream");
  expect(JSON.stringify(stream)).not.toContain("do-not-show");
  expect(JSON.stringify(stream)).not.toContain("rawPayload");

  const trace = await service.exportAcpActivity(userId, { limit: 10 });
  expect(trace.stream.retryEligible).toBe(true);
  expect(trace.stream.gaps[0]?.deltaMs).toBe(2_500);
  expect(JSON.stringify(trace.stream)).not.toContain("do-not-show");
  expect(JSON.stringify(trace.stream)).not.toContain("rawPayload");

  const retried = await service.retryAcpActivityStream(userId);
  expect(retried.acpActivity.stream.retryDelayMs).toBe(1000);
  expect(retried.acpActivity.stream.retryMaxAttempts).toBe(5);
  expect(JSON.stringify(retried.acpActivity)).not.toContain("do-not-show");
  expect(JSON.stringify(retried.acpActivity)).not.toContain("rawPayload");
});

test("exports redacted ACP activity for a selected chat", async () => {
  const storedSession: StoredSession = {
    id: "chat-owned",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "running",
    createdAt: 1000,
    lastActiveAt: 1200,
    messages: [],
    messageCount: 0,
  };
  const service = createService([], {
    storedSessions: { "chat-owned": storedSession },
    logEntries: [
      {
        id: "log-turn",
        timestamp: 1400,
        level: "warn",
        source: "acp",
        message: "Prompt streaming watchdog: no ACP chunks observed",
        chatId: "chat-owned",
        meta: {
          method: "prompt",
          sessionId: "agent-session-owned",
          turnId: "turn-owned",
          rawPayloadLength: 16,
          rawPayload: '{"token":"do-not-show"}',
        },
      },
      {
        id: "log-new-session",
        timestamp: 1300,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "newSession",
          rawPayloadLength: 128,
          rawPayload: '{"token":"do-not-show"}',
          token: "do-not-show",
        },
      },
      {
        id: "log-initialize",
        timestamp: 1200,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "initialize",
          rawPayloadLength: 256,
          rawPayload: '{"secret":"do-not-show"}',
        },
      },
      {
        id: "log-other-chat",
        timestamp: 1100,
        level: "debug",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-other",
        meta: {
          rawType: "agent_message_chunk",
          rawPayloadLength: 64,
        },
      },
      {
        id: "log-other-user",
        timestamp: 1000,
        level: "error",
        userId: "other-user",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-owned",
        meta: {
          rawType: "tool_call",
          rawPayloadLength: 32,
        },
      },
    ],
  });

  const trace = await service.exportAcpActivity(userId, {
    chatId: "chat-owned",
    limit: 2,
  });

  expect(trace.schemaVersion).toBe(1);
  expect(trace.redacted).toBe(true);
  expect(trace.projectRoot).toBe(tempRoot);
  expect(trace.filters).toEqual({ chatId: "chat-owned", limit: 2 });
  expect(trace.stats.total).toBe(3);
  expect(trace.stats.chatCount).toBe(1);
  expect(trace.entries.map((entry) => entry.id)).toEqual([
    "log-turn",
    "log-new-session",
  ]);
  expect(trace.entries[0]?.metadata).toEqual({
    method: "prompt",
    sessionId: "agent-session-owned",
    turnId: "turn-owned",
  });
  expect(trace.entries[1]?.payloadBytes).toBe(128);
  expect(trace.entries[1]?.metadata).toEqual({
    step: "newSession",
  });
  const turnCorrelation = trace.correlations.find(
    (correlation) => correlation.turnId === "turn-owned"
  );
  expect(turnCorrelation?.label).toBe("turn");
  expect(turnCorrelation?.eventCount).toBe(1);
  expect(turnCorrelation?.levels.warn).toBe(1);
  const chatCorrelation = trace.correlations.find(
    (correlation) => correlation.chatId === "chat-owned" && !correlation.turnId
  );
  expect(chatCorrelation?.eventCount).toBe(2);
  const serialized = JSON.stringify(trace);
  expect(serialized).not.toContain("do-not-show");
  expect(serialized).not.toContain("rawPayload");
  expect(serialized).not.toContain("token");
  expect(serialized).not.toContain("log-other-user");
  expect(serialized).not.toContain("log-other-chat");
});

test("replays redacted ACP activity frames chronologically", async () => {
  const storedSession: StoredSession = {
    id: "chat-owned",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "running",
    createdAt: 1000,
    lastActiveAt: 1400,
    messages: [],
    messageCount: 0,
  };
  const service = createService([], {
    storedSessions: { "chat-owned": storedSession },
    logEntries: [
      {
        id: "log-turn",
        timestamp: 1400,
        level: "warn",
        source: "acp",
        message: "Prompt streaming watchdog: no ACP chunks observed",
        chatId: "chat-owned",
        meta: {
          method: "prompt",
          sessionId: "agent-session-owned",
          turnId: "turn-owned",
          rawPayloadLength: 16,
          rawPayload: '{"token":"do-not-show"}',
        },
      },
      {
        id: "log-new-session",
        timestamp: 1300,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "newSession",
          rawPayloadLength: 128,
          rawPayload: '{"token":"do-not-show"}',
          token: "do-not-show",
        },
      },
      {
        id: "log-initialize",
        timestamp: 1200,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "initialize",
          rawPayloadLength: 256,
          rawPayload: '{"secret":"do-not-show"}',
        },
      },
      {
        id: "log-other-user",
        timestamp: 1100,
        level: "error",
        userId: "other-user",
        source: "acp",
        message: "ACP session update",
        chatId: "chat-owned",
        meta: {
          rawType: "tool_call",
          rawPayloadLength: 32,
        },
      },
    ],
  });

  const replay = await service.replayAcpActivity(userId, {
    chatId: "chat-owned",
    limit: 3,
  });

  expect(replay.schemaVersion).toBe(1);
  expect(replay.redacted).toBe(true);
  expect(replay.filters).toEqual({ chatId: "chat-owned", limit: 3 });
  expect(replay.frames.map((frame) => frame.id)).toEqual([
    "log-initialize",
    "log-new-session",
    "log-turn",
  ]);
  expect(replay.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3]);
  expect(replay.frames.map((frame) => frame.elapsedMs)).toEqual([0, 100, 200]);
  expect(replay.frames.map((frame) => frame.deltaMs)).toEqual([0, 100, 100]);
  expect(replay.frames[2]?.correlationKey).toBe("turn:turn-owned");
  expect(replay.frames[2]?.correlationLabel).toBe("turn");
  expect(replay.frames[2]?.metadata).toEqual({
    method: "prompt",
    sessionId: "agent-session-owned",
    turnId: "turn-owned",
  });
  expect(replay.correlations.some((item) => item.chatId === "chat-owned")).toBe(true);
  expect(JSON.stringify(replay)).not.toContain("do-not-show");
  expect(JSON.stringify(replay)).not.toContain("rawPayload");
  expect(JSON.stringify(replay)).not.toContain("token");
  expect(JSON.stringify(replay)).not.toContain("log-other-user");

  const turnReplay = await service.replayAcpActivity(userId, {
    chatId: "chat-owned",
    correlationKey: "turn:turn-owned",
    limit: 10,
  });
  expect(turnReplay.filters).toEqual({
    chatId: "chat-owned",
    correlationKey: "turn:turn-owned",
    limit: 10,
  });
  expect(turnReplay.frames.map((frame) => frame.id)).toEqual(["log-turn"]);

  const kindReplay = await service.replayAcpActivity(userId, {
    chatId: "chat-owned",
    kind: "initialize",
    limit: 10,
  });
  expect(kindReplay.filters).toEqual({
    chatId: "chat-owned",
    kind: "initialize",
    limit: 10,
  });
  expect(kindReplay.frames.map((frame) => frame.id)).toEqual(["log-initialize"]);
  expect(kindReplay.frames.every((frame) => frame.kind === "initialize")).toBe(true);
  expect(kindReplay.stats.kinds).toEqual({ initialize: 1 });

  const limitedReplay = await service.replayAcpActivity(userId, {
    chatId: "chat-owned",
    limit: 2,
  });
  expect(limitedReplay.frames.map((frame) => frame.id)).toEqual([
    "log-new-session",
    "log-turn",
  ]);
  expect(limitedReplay.diagnostics.join("\n")).toContain("omitted");
});

test("saves and deletes project-local ACP replay presets", async () => {
  const storedSession: StoredSession = {
    id: "chat-owned",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "running",
    createdAt: 1000,
    lastActiveAt: 1400,
    messages: [],
    messageCount: 0,
  };
  const service = createService([], {
    storedSessions: { "chat-owned": storedSession },
    logEntries: [
      {
        id: "log-new-session",
        timestamp: 1300,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "newSession",
          rawPayloadLength: 128,
          rawPayload: '{"token":"do-not-show"}',
        },
      },
      {
        id: "log-initialize",
        timestamp: 1200,
        level: "info",
        source: "acp",
        message: "ACP raw session setup payload",
        chatId: "chat-owned",
        meta: {
          step: "initialize",
          rawPayloadLength: 256,
          rawPayload: '{"secret":"do-not-show"}',
        },
      },
    ],
  });

  const saved = await service.saveAcpReplayPreset(userId, {
    name: "  Initialize   replay  ",
    chatId: "chat-owned",
    kind: "initialize",
    limit: 10,
  });

  expect(saved.acpActivity.replayPresets).toHaveLength(1);
  const preset = saved.acpActivity.replayPresets[0];
  expect(preset?.name).toBe("Initialize replay");
  expect(preset?.chatId).toBe("chat-owned");
  expect(preset?.kind).toBe("initialize");
  expect(preset?.limit).toBe(10);
  const persisted = await readFile(
    path.join(tempRoot, ".eragear", "acp-replay-presets.json"),
    "utf8"
  );
  expect(persisted).toContain("Initialize replay");
  expect(persisted).not.toContain("do-not-show");
  expect(persisted).not.toContain("rawPayload");

  const replay = await service.replayAcpActivity(userId, {
    chatId: preset?.chatId,
    kind: preset?.kind,
    limit: preset?.limit,
  });
  expect(replay.filters).toEqual({
    chatId: "chat-owned",
    kind: "initialize",
    limit: 10,
  });
  expect(replay.frames.map((frame) => frame.id)).toEqual(["log-initialize"]);

  const updated = await service.saveAcpReplayPreset(userId, {
    id: preset?.id,
    name: "New session replay",
    chatId: "chat-owned",
    kind: "newSession",
    limit: 5,
  });
  expect(updated.acpActivity.replayPresets).toHaveLength(1);
  expect(updated.acpActivity.replayPresets[0]?.id).toBe(preset?.id);
  expect(updated.acpActivity.replayPresets[0]?.kind).toBe("newSession");
  expect(updated.acpActivity.replayPresets[0]?.limit).toBe(5);

  const deleted = await service.deleteAcpReplayPreset(userId, {
    id: preset?.id ?? "",
  });
  expect(deleted.acpActivity.replayPresets).toEqual([]);
});

test("captures checkpoint patch metadata from a git worktree", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "README.md"), "initial\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "README.md"), "initial\nchanged\n", "utf8");
  const checkpointHookScript = path.join(tempRoot, "checkpoint-hook.js");
  await writeFile(
    checkpointHookScript,
    "process.stdout.write('checkpoint lifecycle '+process.env.ERAGEAR_HOOK_EVENT);",
    "utf8"
  );

  const activeSession = {
    id: "chat-checkpoint-1",
    userId,
    projectId: "project-1",
    projectRoot: tempRoot,
    sessionId: "agent-session-1",
    chatStatus: "streaming",
    subscriberCount: 1,
    pendingPermissions: new Map(),
    toolCalls: new Map([["tool-1", {}]]),
    uiState: {
      messages: new Map([
        [
          "ui-message-1",
          {
            id: "ui-message-1",
            role: "user",
            parts: [{ type: "text", text: "Update checkpoint restore UX" }],
            createdAt: 3000,
          },
        ],
      ]),
    },
    activeTurnId: "turn-active-1",
    lastCompletedTurnId: "turn-complete-1",
    agentInfo: { title: "OpenCode Active" },
  } as unknown as RuntimeSession;
  const storedSession: StoredSession = {
    id: "chat-checkpoint-1",
    userId,
    name: "Checkpoint Session",
    projectId: "project-1",
    projectRoot: tempRoot,
    sessionId: "agent-session-1",
    agentName: "Stored Agent",
    status: "running",
    createdAt: 1000,
    lastActiveAt: 3000,
    messages: [
      {
        id: "stored-message-1",
        role: "assistant",
        content: "Stored checkpoint reply",
        timestamp: 2500,
      },
    ],
    messageCount: 3,
  };
  const service = createService([], {
    activeSessions: [activeSession],
    storedSessions: { "chat-checkpoint-1": storedSession },
  });
  const createHookSnapshot = await service.upsertHook(userId, {
    id: "checkpoint-create-hook",
    name: "Checkpoint Create Hook",
    event: "after-checkpoint-create",
    command: process.execPath,
    args: [checkpointHookScript],
  });
  const restoreHookSnapshot = await service.upsertHook(userId, {
    id: "checkpoint-restore-hook",
    name: "Checkpoint Restore Hook",
    event: "after-checkpoint-restore",
    command: process.execPath,
    args: [checkpointHookScript],
  });
  const checkpointCreateHook = createHookSnapshot.hooks.items.find(
    (item) => item.id === "checkpoint-create-hook"
  );
  const checkpointRestoreHook = restoreHookSnapshot.hooks.items.find(
    (item) => item.id === "checkpoint-restore-hook"
  );
  await service.trustHook(userId, {
    hookId: "checkpoint-create-hook",
    fingerprint: checkpointCreateHook?.fingerprint ?? "",
  });
  await service.trustHook(userId, {
    hookId: "checkpoint-restore-hook",
    fingerprint: checkpointRestoreHook?.fingerprint ?? "",
  });
  const updated = await service.createCheckpoint(userId, {
    name: "Unit checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const createHook = updated.hooks.items.find(
    (item) => item.id === "checkpoint-create-hook"
  );
  const patch = await readFile(checkpoint?.patchPath ?? "", "utf8");
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });

  expect(createHook?.lastRun?.status).toBe("success");
  expect(createHook?.lastRun?.stdout).toContain(
    "checkpoint lifecycle after-checkpoint-create"
  );
  expect(checkpoint?.name).toBe("Unit checkpoint");
  expect(checkpoint?.sessionIds).toEqual(["chat-checkpoint-1"]);
  expect(checkpoint?.sessionAttributions[0]).toMatchObject({
    chatId: "chat-checkpoint-1",
    source: "active",
    status: "streaming",
    projectId: "project-1",
    sessionId: "agent-session-1",
    agentName: "OpenCode Active",
    messageCount: 3,
    lastMessageRole: "user",
    lastMessagePreview: "Update checkpoint restore UX",
    lastMessageAt: 3000,
    activeTurnId: "turn-active-1",
    lastCompletedTurnId: "turn-complete-1",
    subscriberCount: 1,
    pendingPermissions: 0,
    activeToolCalls: 1,
  });
  expect(checkpoint?.changedFiles).toContain("README.md");
  expect(checkpoint?.patchBytes).toBeGreaterThan(0);
  expect(patch).toContain("+changed");
  expect(preview.preview).toContain("+changed");
  expect(preview.canRestore).toBe(true);
  expect(preview.restoreBlockers).toEqual([]);
  const readmeDiff = preview.diffFiles.find((item) => item.path === "README.md");
  expect(readmeDiff?.status).toBe("modified");
  expect(readmeDiff?.additions).toBe(1);
  expect(readmeDiff?.deletions).toBe(0);
  expect(
    readmeDiff?.hunks.some((hunk) =>
      hunk.rows.some((row) => row.kind === "add" && row.newText === "changed")
    )
  ).toBe(true);
  expect(preview.sessionAttributions[0]?.chatId).toBe("chat-checkpoint-1");
  expect(preview.sessionAttributions[0]?.lastMessagePreview).toBe(
    "Update checkpoint restore UX"
  );
  const readmeRisk = preview.restoreRisks.find((item) => item.file === "README.md");
  expect(readmeRisk?.level).toBe("safe");
  expect(readmeRisk?.patchAction).toBe("revert tracked changes");
  expect(readmeRisk?.checkpointStatus).toBe(" M README.md");
  expect(readmeRisk?.currentStatus).toBe(" M README.md");

  await writeFile(path.join(tempRoot, "EXTRA.md"), "new conflict\n", "utf8");
  const conflictPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const extraRisk = conflictPreview.restoreRisks.find(
    (item) => item.file === "EXTRA.md"
  );
  expect(conflictPreview.canRestore).toBe(false);
  expect(conflictPreview.restoreBlockers.length).toBeGreaterThan(0);
  expect(extraRisk?.level).toBe("blocked");
  expect(extraRisk?.reason).toContain("not part of the restore precondition");
  await rm(path.join(tempRoot, "EXTRA.md"), { force: true });

  await expect(
    service.restoreCheckpoint(userId, {
      checkpointId: checkpoint?.id ?? "",
      confirmation: "RESTORE wrong",
    })
  ).rejects.toThrow("Type 'RESTORE");

  const restoredSnapshot = await service.restoreCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: preview.restoreToken,
  });
  const restoredCheckpoint = restoredSnapshot.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const safetyCheckpoint = restoredSnapshot.checkpoints.items.find(
    (item) => item.safetyForCheckpointId === checkpoint?.id
  );
  const restoreHook = restoredSnapshot.hooks.items.find(
    (item) => item.id === "checkpoint-restore-hook"
  );
  const restoredReadme = await readFile(path.join(tempRoot, "README.md"), "utf8");

  expect(restoreHook?.lastRun?.status).toBe("success");
  expect(restoreHook?.lastRun?.stdout).toContain(
    "checkpoint lifecycle after-checkpoint-restore"
  );
  expect(restoredReadme.replace(/\r\n/g, "\n")).toBe("initial\n");
  expect(restoredCheckpoint?.restoredAt).toBeDefined();
  expect(restoredCheckpoint?.canRestore).toBe(false);
  expect(restoredCheckpoint?.preRestoreSafetyCheckpointId).toBe(
    safetyCheckpoint?.id
  );
  expect(safetyCheckpoint?.restoreMode).toBe("apply-patch");
  expect(safetyCheckpoint?.canRestore).toBe(true);
  expect(safetyCheckpoint?.sessionAttributions[0]?.chatId).toBe(
    "chat-checkpoint-1"
  );

  const safetyPreview = await service.previewCheckpoint(userId, {
    checkpointId: safetyCheckpoint?.id ?? "",
  });
  expect(safetyPreview.canRestore).toBe(true);
  const safetyRestored = await service.restoreCheckpoint(userId, {
    checkpointId: safetyCheckpoint?.id ?? "",
    confirmation: safetyPreview.restoreToken,
  });
  const reappliedReadme = await readFile(path.join(tempRoot, "README.md"), "utf8");
  const restoredSafety = safetyRestored.checkpoints.items.find(
    (item) => item.id === safetyCheckpoint?.id
  );
  expect(reappliedReadme.replace(/\r\n/g, "\n")).toBe("initial\nchanged\n");
  expect(restoredSafety?.restoredAt).toBeDefined();
}, 15_000);

test("restores selected checkpoint files while unrelated workspace changes remain", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "README.md"), "initial\n", "utf8");
  await writeFile(path.join(tempRoot, "NOTES.md"), "notes\n", "utf8");
  await execFileAsync("git", ["add", "README.md", "NOTES.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  await writeFile(path.join(tempRoot, "README.md"), "initial\nchanged\n", "utf8");
  await writeFile(path.join(tempRoot, "NOTES.md"), "notes\nchanged\n", "utf8");

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Selective checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(preview.diffFiles.map((file) => file.path).sort()).toEqual([
    "NOTES.md",
    "README.md",
  ]);

  await writeFile(path.join(tempRoot, "EXTRA.md"), "unrelated\n", "utf8");
  const blockedPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(blockedPreview.canRestore).toBe(false);
  expect(
    blockedPreview.restoreRisks.some(
      (risk) => risk.file === "EXTRA.md" && risk.level === "blocked"
    )
  ).toBe(true);

  const selectedSnapshot = await service.restoreCheckpointFiles(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: preview.restoreToken,
    files: ["README.md"],
  });
  const selectedCheckpoint = selectedSnapshot.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const selectedSafetyCheckpoint = selectedSnapshot.checkpoints.items.find(
    (item) => item.id === selectedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
  );

  expect((await readFile(path.join(tempRoot, "README.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "initial\n"
  );
  expect((await readFile(path.join(tempRoot, "NOTES.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "notes\nchanged\n"
  );
  expect((await readFile(path.join(tempRoot, "EXTRA.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "unrelated\n"
  );
  expect(selectedCheckpoint?.restoredAt).toBeUndefined();
  expect(selectedCheckpoint?.partialRestores?.[0]?.files).toEqual(["README.md"]);
  expect(selectedSafetyCheckpoint?.changedFiles).toEqual(["README.md"]);
  expect(selectedSafetyCheckpoint?.restoreMode).toBe("apply-patch");

  const safetyPreview = await service.previewCheckpoint(userId, {
    checkpointId: selectedSafetyCheckpoint?.id ?? "",
  });
  const safetyRestored = await service.restoreCheckpointFiles(userId, {
    checkpointId: selectedSafetyCheckpoint?.id ?? "",
    confirmation: safetyPreview.restoreToken,
    files: ["README.md"],
  });
  const restoredSafety = safetyRestored.checkpoints.items.find(
    (item) => item.id === selectedSafetyCheckpoint?.id
  );
  expect((await readFile(path.join(tempRoot, "README.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "initial\nchanged\n"
  );
  expect(restoredSafety?.partialRestores?.[0]?.files).toEqual(["README.md"]);
}, 15_000);

test("shelves untracked checkpoint blockers before guarded full restore", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "README.md"), "initial\n", "utf8");
  await writeFile(path.join(tempRoot, "NOTES.md"), "notes\n", "utf8");
  await execFileAsync("git", ["add", "README.md", "NOTES.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  await writeFile(path.join(tempRoot, "README.md"), "initial\nchanged\n", "utf8");
  await writeFile(path.join(tempRoot, "NOTES.md"), "notes\nchanged\n", "utf8");

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Shelve conflict checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });

  await writeFile(path.join(tempRoot, "EXTRA.md"), "keep me\n", "utf8");
  const blockedPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const extraRisk = blockedPreview.restoreRisks.find(
    (risk) => risk.file === "EXTRA.md"
  );
  expect(blockedPreview.canRestore).toBe(false);
  expect(extraRisk?.level).toBe("blocked");
  expect(extraRisk?.currentStatus).toBe("?? EXTRA.md");

  await expect(
    service.shelveCheckpointConflicts(userId, {
      checkpointId: checkpoint?.id ?? "",
      confirmation: "RESTORE wrong",
      files: ["EXTRA.md"],
    })
  ).rejects.toThrow("Type 'RESTORE");

  const shelvedSnapshot = await service.shelveCheckpointConflicts(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: preview.restoreToken,
    files: ["EXTRA.md"],
  });
  const shelvedCheckpoint = shelvedSnapshot.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const shelf = shelvedCheckpoint?.conflictShelves?.[0];

  expect(existsSync(path.join(tempRoot, "EXTRA.md"))).toBe(false);
  expect(shelf?.files).toEqual(["EXTRA.md"]);
  expect(shelf?.shelfPath).toContain("checkpoint-shelves");
  expect(
    (await readFile(path.join(shelf?.shelfPath ?? "", "EXTRA.md"), "utf8")).replace(
      /\r\n/g,
      "\n"
    )
  ).toBe("keep me\n");

  const readyPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(readyPreview.canRestore).toBe(true);
  expect(readyPreview.restoreRisks.some((risk) => risk.file === "EXTRA.md")).toBe(
    false
  );

  const restored = await service.restoreCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: readyPreview.restoreToken,
  });
  const restoredCheckpoint = restored.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );

  expect((await readFile(path.join(tempRoot, "README.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "initial\n"
  );
  expect((await readFile(path.join(tempRoot, "NOTES.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "notes\n"
  );
  expect(restoredCheckpoint?.restoredAt).toBeDefined();
  expect(existsSync(path.join(shelf?.shelfPath ?? "", "EXTRA.md"))).toBe(true);
}, 15_000);

test("resolves tracked checkpoint patch conflicts with a safety checkpoint", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "TRACKED.md"), "line 1\nline 2\n", "utf8");
  await execFileAsync("git", ["add", "TRACKED.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  await writeFile(
    path.join(tempRoot, "TRACKED.md"),
    "line 1\nline 2 checkpoint\n",
    "utf8"
  );

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Tracked conflict checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(preview.restoreRisks.find((risk) => risk.file === "TRACKED.md")?.level).toBe(
    "safe"
  );

  await writeFile(
    path.join(tempRoot, "TRACKED.md"),
    "line 1\nline 2 user edit\n",
    "utf8"
  );
  const conflictPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const trackedRisk = conflictPreview.restoreRisks.find(
    (risk) => risk.file === "TRACKED.md"
  );
  expect(conflictPreview.canRestore).toBe(false);
  expect(trackedRisk?.level).toBe("blocked");
  expect(trackedRisk?.currentStatus).toBe(" M TRACKED.md");
  expect(trackedRisk?.reason).toContain(
    "Tracked checkpoint patch no longer applies cleanly"
  );

  await expect(
    service.resolveCheckpointTrackedConflicts(userId, {
      checkpointId: checkpoint?.id ?? "",
      confirmation: "RESTORE wrong",
      files: ["TRACKED.md"],
    })
  ).rejects.toThrow("Type 'RESTORE");

  const resolved = await service.resolveCheckpointTrackedConflicts(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: conflictPreview.restoreToken,
    files: ["TRACKED.md"],
  });
  const resolvedCheckpoint = resolved.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const safetyCheckpoint = resolved.checkpoints.items.find(
    (item) => item.id === resolvedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
  );

  expect((await readFile(path.join(tempRoot, "TRACKED.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "line 1\nline 2\n"
  );
  expect(resolvedCheckpoint?.partialRestores?.[0]?.files).toEqual(["TRACKED.md"]);
  expect(resolvedCheckpoint?.partialRestores?.[0]?.resolution).toBe("restore");
  expect(safetyCheckpoint?.changedFiles).toEqual(["TRACKED.md"]);
  expect(safetyCheckpoint?.restoreMode).toBe("apply-patch");

  const safetyPreview = await service.previewCheckpoint(userId, {
    checkpointId: safetyCheckpoint?.id ?? "",
  });
  expect(safetyPreview.canRestore).toBe(true);
  const reapplied = await service.restoreCheckpoint(userId, {
    checkpointId: safetyCheckpoint?.id ?? "",
    confirmation: safetyPreview.restoreToken,
  });
  const restoredSafety = reapplied.checkpoints.items.find(
    (item) => item.id === safetyCheckpoint?.id
  );
  expect((await readFile(path.join(tempRoot, "TRACKED.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "line 1\nline 2 user edit\n"
  );
  expect(restoredSafety?.restoredAt).toBeDefined();
}, 15_000);

test("keeps current tracked checkpoint conflict and restores remaining patch", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await writeFile(path.join(tempRoot, "KEEP.md"), "keep base\n", "utf8");
  await writeFile(path.join(tempRoot, "RESTORE.md"), "restore base\n", "utf8");
  await execFileAsync("git", ["add", "KEEP.md", "RESTORE.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  await writeFile(path.join(tempRoot, "KEEP.md"), "keep checkpoint\n", "utf8");
  await writeFile(
    path.join(tempRoot, "RESTORE.md"),
    "restore checkpoint\n",
    "utf8"
  );

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Tracked conflict choice checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];

  await writeFile(path.join(tempRoot, "KEEP.md"), "keep user edit\n", "utf8");
  const conflictPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(conflictPreview.canRestore).toBe(false);
  expect(
    conflictPreview.restoreRisks.find((risk) => risk.file === "KEEP.md")?.level
  ).toBe("blocked");

  const kept = await service.resolveCheckpointTrackedConflictChoice(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: conflictPreview.restoreToken,
    files: ["KEEP.md"],
    resolution: "current",
  });
  const keptCheckpoint = kept.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  expect(keptCheckpoint?.partialRestores?.[0]).toMatchObject({
    files: ["KEEP.md"],
    resolution: "current",
  });
  expect((await readFile(path.join(tempRoot, "KEEP.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "keep user edit\n"
  );

  const readyPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const keepRisk = readyPreview.restoreRisks.find((risk) => risk.file === "KEEP.md");
  const restoreRisk = readyPreview.restoreRisks.find(
    (risk) => risk.file === "RESTORE.md"
  );
  expect(readyPreview.canRestore).toBe(true);
  expect(keepRisk?.level).toBe("warning");
  expect(keepRisk?.patchAction).toBe("keep current content");
  expect(restoreRisk?.level).toBe("safe");

  const restored = await service.restoreCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: readyPreview.restoreToken,
  });
  const restoredCheckpoint = restored.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  expect((await readFile(path.join(tempRoot, "KEEP.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "keep user edit\n"
  );
  expect((await readFile(path.join(tempRoot, "RESTORE.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "restore base\n"
  );
  expect(restoredCheckpoint?.restoredAt).toBeDefined();
}, 15_000);

test("resolves tracked checkpoint conflicts with per-hunk choices", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  const baseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  await writeFile(path.join(tempRoot, "MIXED.md"), `${baseLines.join("\n")}\n`, "utf8");
  await execFileAsync("git", ["add", "MIXED.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  const checkpointLines = [...baseLines];
  checkpointLines[1] = "line 2 checkpoint";
  checkpointLines[17] = "line 18 checkpoint";
  await writeFile(
    path.join(tempRoot, "MIXED.md"),
    `${checkpointLines.join("\n")}\n`,
    "utf8"
  );

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Tracked hunk conflict checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const initialDiff = preview.diffFiles.find((file) => file.path === "MIXED.md");
  expect(initialDiff?.hunks).toHaveLength(2);

  const currentLines = [...checkpointLines];
  currentLines[17] = "line 18 user current";
  await writeFile(
    path.join(tempRoot, "MIXED.md"),
    `${currentLines.join("\n")}\n`,
    "utf8"
  );

  const conflictPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const risk = conflictPreview.restoreRisks.find(
    (item) => item.file === "MIXED.md"
  );
  expect(conflictPreview.canRestore).toBe(false);
  expect(risk?.level).toBe("blocked");
  expect(risk?.currentStatus).toBe(" M MIXED.md");
  expect(risk?.reason).toContain(
    "Tracked checkpoint patch no longer applies cleanly"
  );

  const mixed = await service.resolveCheckpointTrackedConflictHunks(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: conflictPreview.restoreToken,
    hunks: [{ file: "MIXED.md", hunkIndex: 0 }],
  });
  const mixedCheckpoint = mixed.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const safetyCheckpoint = mixed.checkpoints.items.find(
    (item) => item.id === mixedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
  );
  const afterMixed = (await readFile(path.join(tempRoot, "MIXED.md"), "utf8"))
    .replace(/\r\n/g, "\n")
    .split("\n");

  expect(afterMixed[1]).toBe("line 2");
  expect(afterMixed[17]).toBe("line 18 user current");
  expect(mixedCheckpoint?.partialRestores?.[0]?.files).toEqual(["MIXED.md"]);
  expect(mixedCheckpoint?.partialRestores?.[0]?.resolution).toBe("mixed");
  expect(mixedCheckpoint?.partialRestores?.[0]?.hunks).toEqual([
    expect.objectContaining({
      file: "MIXED.md",
      hunkIndex: 0,
    }),
  ]);
  expect(mixedCheckpoint?.partialRestores?.[0]?.hunkChoices).toEqual([
    expect.objectContaining({
      file: "MIXED.md",
      hunkIndex: 0,
      resolution: "restore",
    }),
    expect.objectContaining({
      file: "MIXED.md",
      hunkIndex: 1,
      resolution: "current",
    }),
  ]);
  expect(safetyCheckpoint?.changedFiles).toEqual(["MIXED.md"]);
  expect(safetyCheckpoint?.restoreMode).toBe("apply-patch");

  await expect(
    service.restoreCheckpoint(userId, {
      checkpointId: checkpoint?.id ?? "",
      confirmation: conflictPreview.restoreToken,
    })
  ).rejects.toThrow("no remaining tracked patch");
}, 15_000);

test("restores selected checkpoint hunks while preserving other hunks in the same file", async () => {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: tempRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "local-ade@example.test"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["config", "user.name", "Local ADE"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  const baseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  await writeFile(path.join(tempRoot, "HUNKS.md"), `${baseLines.join("\n")}\n`, "utf8");
  await execFileAsync("git", ["add", "HUNKS.md"], {
    cwd: tempRoot,
    windowsHide: true,
  });
  await execFileAsync("git", ["commit", "-m", "initial"], {
    cwd: tempRoot,
    windowsHide: true,
  });

  const changedLines = [...baseLines];
  changedLines[1] = "line 2 changed";
  changedLines[17] = "line 18 changed";
  await writeFile(
    path.join(tempRoot, "HUNKS.md"),
    `${changedLines.join("\n")}\n`,
    "utf8"
  );

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Hunk checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  const hunkDiff = preview.diffFiles.find((file) => file.path === "HUNKS.md");
  expect(hunkDiff?.hunks).toHaveLength(2);

  await writeFile(path.join(tempRoot, "EXTRA.md"), "unrelated\n", "utf8");
  const blockedPreview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });
  expect(blockedPreview.canRestore).toBe(false);

  const selectedSnapshot = await service.restoreCheckpointHunks(userId, {
    checkpointId: checkpoint?.id ?? "",
    confirmation: preview.restoreToken,
    hunks: [{ file: "HUNKS.md", hunkIndex: 0 }],
  });
  const selectedCheckpoint = selectedSnapshot.checkpoints.items.find(
    (item) => item.id === checkpoint?.id
  );
  const selectedSafetyCheckpoint = selectedSnapshot.checkpoints.items.find(
    (item) => item.id === selectedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
  );
  const afterSelected = (await readFile(path.join(tempRoot, "HUNKS.md"), "utf8"))
    .replace(/\r\n/g, "\n")
    .split("\n");

  expect(afterSelected[1]).toBe("line 2");
  expect(afterSelected[17]).toBe("line 18 changed");
  expect((await readFile(path.join(tempRoot, "EXTRA.md"), "utf8")).replace(/\r\n/g, "\n")).toBe(
    "unrelated\n"
  );
  expect(selectedCheckpoint?.restoredAt).toBeUndefined();
  expect(selectedCheckpoint?.partialRestores?.[0]?.files).toEqual(["HUNKS.md"]);
  expect(selectedCheckpoint?.partialRestores?.[0]?.hunks).toEqual([
    expect.objectContaining({
      file: "HUNKS.md",
      hunkIndex: 0,
    }),
  ]);
  expect(selectedSafetyCheckpoint?.changedFiles).toEqual(["HUNKS.md"]);
  expect(selectedSafetyCheckpoint?.restoreMode).toBe("apply-patch");

  const safetyPreview = await service.previewCheckpoint(userId, {
    checkpointId: selectedSafetyCheckpoint?.id ?? "",
  });
  expect(safetyPreview.diffFiles.find((file) => file.path === "HUNKS.md")?.hunks).toHaveLength(
    1
  );
  const safetyRestored = await service.restoreCheckpointHunks(userId, {
    checkpointId: selectedSafetyCheckpoint?.id ?? "",
    confirmation: safetyPreview.restoreToken,
    hunks: [{ file: "HUNKS.md", hunkIndex: 0 }],
  });
  const restoredSafety = safetyRestored.checkpoints.items.find(
    (item) => item.id === selectedSafetyCheckpoint?.id
  );
  const afterSafety = (await readFile(path.join(tempRoot, "HUNKS.md"), "utf8"))
    .replace(/\r\n/g, "\n")
    .split("\n");
  expect(afterSafety[1]).toBe("line 2 changed");
  expect(afterSafety[17]).toBe("line 18 changed");
  expect(restoredSafety?.partialRestores?.[0]?.hunks?.[0]?.file).toBe("HUNKS.md");
}, 15_000);
