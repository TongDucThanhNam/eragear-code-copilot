import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
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
import type { AgentConfig } from "@/shared/types/agent.types";
import type { LogEntry, LogQuery } from "@/shared/types/log.types";
import type { Project } from "@/shared/types/project.types";
import { matchesLogQuery } from "@/shared/utils/log-query.util";

const userId = "local-test-user";
let tempRoot = "";
const execFileAsync = promisify(execFile);
type RuntimeSession = ReturnType<SessionRuntimePort["getAll"]>[number];

interface CreateServiceOptions {
  activeSessions?: RuntimeSession[];
  storedSessions?: Record<string, StoredSession>;
  logEntries?: LogEntry[];
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "eragear-local-ade-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

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
  return new LocalAdeService({
    projectRepo,
    agentRepo,
    sessionRepo,
    sessionRuntime,
    logStore,
  });
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
  close: () => Promise<void>;
}> {
  const clients = new Set<ServerResponse>();
  const requestCounts: Record<string, number> = {};
  let firstRequestStreamClosed = false;
  let methodStreamClosed = false;
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
    expect(hook?.trustStatus).toBe("untrusted");
    expect(capability?.kind).toBe("hook");
    expect(capability?.enabled).toBe(false);
    await expect(
      service.runHook(userId, { hookId: "hook-test" })
    ).rejects.toThrow("must be trusted");

    const disabled = await service.toggleHook(userId, {
      id: "hook-test",
      enabled: false,
    });
    expect(disabled.hooks.items.find((item) => item.id === "hook-test")?.enabled).toBe(
      false
    );
    await expect(
      service.runHook(userId, { hookId: "hook-test" })
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
      service.runHook(userId, { hookId: "hook-test" })
    ).rejects.toThrow("changed after trust approval");
    await service.trustHook(userId, {
      hookId: "hook-test",
      fingerprint: changedHook?.fingerprint ?? "",
    });

    const ran = await service.runHook(userId, { hookId: "hook-test" });
    const ranHook = ran.hooks.items.find((item) => item.id === "hook-test");
    const stored = JSON.parse(
      await readFile(path.join(tempRoot, ".eragear", "hooks.json"), "utf8")
    );

    expect(ranHook?.lastRun?.status).toBe("success");
    expect(ranHook?.lastRun?.stdout).toContain("hook event=manual-check");
    expect(ranHook?.lastRun?.stdout).toContain("allowed_secret= [redacted]");
    expect(ranHook?.lastRun?.stdout).toContain("blocked=false");
    expect(ranHook?.lastRun?.stdout).not.toContain("unit-hook-secret");
    expect(ranHook?.lastRun?.stdout).not.toContain("blocked-unit-hook-secret");
    expect(ranHook?.lastRun?.stderr).toContain("api_key= [redacted]");
    expect(ranHook?.lastRun?.stderr).not.toContain("super-secret-value");
    expect(stored.runs[0].status).toBe("success");
    expect(stored.runs[0].stderr).not.toContain("super-secret-value");
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
  expect(plugin?.trustStatus).toBe("untrusted");
  expect(capability?.kind).toBe("plugin");
  expect(capability?.enabled).toBe(false);
  await expect(
    service.runPlugin(userId, { pluginId: "plugin-test" })
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
  expect(trustedCapability?.enabled).toBe(true);

  const disabled = await service.updateCapabilityState(userId, {
    capabilityId: "plugin.project.plugin-test",
    enabled: false,
  });
  expect(
    disabled.plugins.items.find((item) => item.id === "plugin-test")?.enabled
  ).toBe(false);
  await expect(
    service.runPlugin(userId, { pluginId: "plugin-test" })
  ).rejects.toThrow("Plugin is disabled");

  await service.togglePlugin(userId, { id: "plugin-test", enabled: true });
  const ran = await service.runPlugin(userId, { pluginId: "plugin-test" });
  const ranPlugin = ran.plugins.items.find((item) => item.id === "plugin-test");
  const stored = JSON.parse(
    await readFile(path.join(tempRoot, ".eragear", "plugins.json"), "utf8")
  );

  expect(ranPlugin?.lastRun?.status).toBe("success");
  expect(ranPlugin?.lastRun?.stdout).toContain("plugin name=Smoke Plugin");
  expect(ranPlugin?.lastRun?.stdout).toContain("scopes=process,project-root,env");
  expect(ranPlugin?.lastRun?.stdout).toContain("allowed_secret= [redacted]");
  expect(ranPlugin?.lastRun?.stdout).toContain("blocked=false");
  expect(ranPlugin?.lastRun?.stdout).not.toContain("unit-plugin-secret");
  expect(ranPlugin?.lastRun?.stdout).not.toContain("blocked-unit-plugin-secret");
  expect(ranPlugin?.lastRun?.stderr).toContain("token= [redacted]");
  expect(ranPlugin?.lastRun?.stderr).not.toContain("plugin-secret-value");
  expect(stored.plugins[0].id).toBe("plugin-test");
  expect(stored.plugins[0].scopes).toEqual(["process", "project-root", "env"]);
  expect(stored.plugins[0].envKeys).toEqual(["LOCAL_ADE_PLUGIN_ALLOWED"]);
  expect(stored.plugins[0].trustedFingerprint).toBe(ranPlugin?.fingerprint);
  expect(stored.runs[0].status).toBe("success");
  expect(stored.runs[0].stderr).not.toContain("plugin-secret-value");

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
    service.runPlugin(userId, { pluginId: "plugin-test" })
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

    expect(remoteRoute?.status).toBe("conditional");
    expect(remoteRoute?.brokerMode).toBe("native-agent-transport");
    expect(remoteRoute?.requiresAgentCapability).toBe("http");
    expect(remoteRoute?.agentSupport).toBe("required-at-session-start");
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
