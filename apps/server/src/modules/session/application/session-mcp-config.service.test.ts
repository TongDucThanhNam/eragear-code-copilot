import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import type { SettingsRepositoryPort } from "@/modules/settings";
import type { Settings } from "@/shared/types/settings.types";
import {
  projectLocalMcpFingerprint,
  resolveMcpAgentBrokerRuntimeCommand,
  resolveMcpAgentBrokerScript,
  SessionMcpConfigService,
} from "./session-mcp-config.service";

const defaultSettings: Settings = {
  ui: {
    theme: "system",
    accentColor: "#000000",
    density: "comfortable",
    fontScale: 1,
  },
  projectRoots: [],
  mcpServers: [],
  app: {
    sessionIdleTimeoutMs: 60_000,
    sessionListPageMaxLimit: 100,
    sessionMessagesPageMaxLimit: 100,
    logLevel: "info",
    maxTokens: 0,
    defaultModel: "",
    acpPromptMetaPolicy: "allowlist",
    acpPromptMetaAllowlist: [],
  },
};

function createSettingsRepo(settings: Settings = defaultSettings): SettingsRepositoryPort {
  return {
    get: async () => settings,
    update: async (patch) => ({ ...settings, ...patch }),
  };
}

async function withProjectRoot(
  work: (rootPath: string) => Promise<void>
): Promise<void> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "eragear-mcp-config-"));
  try {
    await mkdir(path.join(rootPath, ".eragear"), { recursive: true });
    await work(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

async function writeProjectMcpConfig(rootPath: string, servers: unknown[]) {
  await writeFile(
    path.join(rootPath, ".eragear", "mcp-servers.json"),
    `${JSON.stringify({ version: 1, servers }, null, 2)}\n`,
    "utf8"
  );
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
  }
  return body;
}

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP test server address."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function mcpResponse(message: Record<string, unknown>, authHeader: string | undefined) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "broker-remote-test", version: "1" },
        capabilities: { tools: {}, resources: {} },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [{ name: "remote_broker_tool" }] },
    };
  }
  if (message.method === "tools/call") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: `remote broker result authorization=${authHeader ?? ""}`,
          },
        ],
      },
    };
  }
  return { jsonrpc: "2.0", id: message.id, result: {} };
}

async function withStreamableHttpMcpServer(
  work: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    const message = JSON.parse(await readRequestBody(request)) as Record<
      string,
      unknown
    >;
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "mcp-session-id": "broker-http-session",
    });
    response.end(
      JSON.stringify(
        mcpResponse(message, request.headers.authorization?.toString())
      )
    );
  });
  const port = await listen(server);
  try {
    await work(`http://127.0.0.1:${port}/mcp`);
  } finally {
    await closeServer(server);
  }
}

async function withSseMcpServer(work: (url: string) => Promise<void>): Promise<void> {
  let sseResponse: ServerResponse | null = null;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/sse") {
      sseResponse = response;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write("event: endpoint\ndata: /messages\n\n");
      request.on("close", () => {
        if (sseResponse === response) {
          sseResponse = null;
        }
      });
      return;
    }
    if (request.method === "POST" && request.url === "/messages") {
      const message = JSON.parse(await readRequestBody(request)) as Record<
        string,
        unknown
      >;
      if (message.id !== undefined && sseResponse) {
        sseResponse.write(
          `data: ${JSON.stringify(
            mcpResponse(message, request.headers.authorization?.toString())
          )}\n\n`
        );
      }
      response.writeHead(202).end();
      return;
    }
    response.writeHead(404).end();
  });
  const port = await listen(server);
  try {
    await work(`http://127.0.0.1:${port}/sse`);
  } finally {
    const openResponse = sseResponse as unknown as ServerResponse | null;
    if (openResponse) {
      openResponse.end();
    }
    await closeServer(server);
  }
}

test("resolves MCP agent broker script from packaged dist runtime assets", async () => {
  await withProjectRoot(async (rootPath) => {
    const moduleDir = path.join(rootPath, "dist");
    const brokerPath = path.join(moduleDir, "runtime", "mcp-agent-broker.js");
    await mkdir(path.dirname(brokerPath), { recursive: true });
    await writeFile(brokerPath, "export {};\n", "utf8");

    expect(
      resolveMcpAgentBrokerScript({
        cwd: rootPath,
        moduleDir,
        env: {},
      })
    ).toBe(brokerPath);
  });
});

test("uses configured MCP broker runtime command before process runtime fallback", () => {
  expect(
    resolveMcpAgentBrokerRuntimeCommand({
      ERAGEAR_MCP_AGENT_BROKER_RUNTIME: "node",
    })
  ).toBe("node");
});

test("injects trusted project-local stdio MCP servers into ACP session config", async () => {
  await withProjectRoot(async (rootPath) => {
    const server = {
      id: "local-stdio",
      name: "Local Stdio MCP",
      transport: "stdio" as const,
      enabled: true,
      command: "node",
      args: ["server.js"],
      env: { LOCAL_MCP_TOKEN: "secret-value" },
    };
    await writeProjectMcpConfig(rootPath, [
      {
        ...server,
        trustedFingerprint: projectLocalMcpFingerprint(server),
      },
    ]);

    const service = new SessionMcpConfigService(createSettingsRepo());
    const resolved = await service.resolveServers(rootPath, {
      mcpCapabilities: {},
    });
    const acpServers = service.toAcpServers(resolved);

    expect(resolved).toEqual([
      {
        name: "Local Stdio MCP",
        command: process.execPath,
        args: [
          expect.stringContaining("mcp-agent-broker.js"),
          "--project-root",
          rootPath,
          "--server-id",
          "local-stdio",
          "--fingerprint",
          projectLocalMcpFingerprint(server),
        ],
        env: [],
      },
    ]);
    expect(acpServers).toEqual([
      {
        name: "Local Stdio MCP",
        command: process.execPath,
        args: [
          expect.stringContaining("mcp-agent-broker.js"),
          "--project-root",
          rootPath,
          "--server-id",
          "local-stdio",
          "--fingerprint",
          projectLocalMcpFingerprint(server),
        ],
        env: [],
      },
    ]);
  });
});

test("requires project-local MCP remote control changes in session trust fingerprints", async () => {
  await withProjectRoot(async (rootPath) => {
    const baseServer = {
      id: "local-sse-controls",
      name: "Local SSE Controls",
      transport: "sse" as const,
      enabled: true,
      url: "http://127.0.0.1:9812/sse",
      messageEndpoint: "http://127.0.0.1:9812/messages",
    };
    const controlledServer = {
      ...baseServer,
      remoteControls: {
        requestTimeoutMs: 2500,
        reconnectAttempts: 2,
        notificationWatchMs: 500,
      },
    };
    await writeProjectMcpConfig(rootPath, [
      {
        ...controlledServer,
        trustedFingerprint: projectLocalMcpFingerprint(baseServer),
      },
    ]);

    const service = new SessionMcpConfigService(createSettingsRepo());
    const changed = await service.resolveServers(rootPath, {
      mcpCapabilities: { sse: true },
    });
    expect(changed).toEqual([]);

    await writeProjectMcpConfig(rootPath, [
      {
        ...controlledServer,
        trustedFingerprint: projectLocalMcpFingerprint(controlledServer),
      },
    ]);
    const resolved = await service.resolveServers(rootPath, {
      mcpCapabilities: { sse: true },
    });

    expect(resolved).toHaveLength(1);
    const resolvedServer = resolved[0];
    if (!resolvedServer || !("args" in resolvedServer)) {
      throw new Error("Expected trusted MCP server to resolve as stdio.");
    }
    expect(resolvedServer.args).toContain(
      projectLocalMcpFingerprint(controlledServer)
    );
    expect(projectLocalMcpFingerprint(controlledServer)).not.toBe(
      projectLocalMcpFingerprint(baseServer)
    );
  });
});

async function requestJsonRpc(
  child: ReturnType<typeof spawn>,
  method: string,
  params: unknown = {}
): Promise<Record<string, unknown>> {
  if (!child.stdout || !child.stdin) {
    throw new Error("Expected stdio pipes for MCP broker test.");
  }
  const stdout = child.stdout;
  const stdin = child.stdin;
  const id = `${Date.now()}-${Math.random()}`;
  let buffer = "";
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stdout.off("data", onData);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.id !== id) {
          continue;
        }
        clearTimeout(timeout);
        stdout.off("data", onData);
        resolve(message);
      }
    };
    stdout.on("data", onData);
    stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
    );
  });
}

async function closeChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.stdin) {
    child.kill();
    return;
  }
  await new Promise<void>((resolve) => {
    const killTimeout = setTimeout(() => {
      child.kill();
    }, 500);
    const resolveTimeout = setTimeout(() => {
      resolve();
    }, 2000);
    child.once("close", () => {
      clearTimeout(killTimeout);
      clearTimeout(resolveTimeout);
      resolve();
    });
    child.stdin?.end();
  });
}

test("brokers project-local stdio MCP calls through trust enforcement and redacted audit", async () => {
  await withProjectRoot(async (rootPath) => {
    const targetScript = path.join(rootPath, "server.js");
    await writeFile(
      targetScript,
      `
process.stdin.setEncoding("utf8");
let buffer = "";
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "broker-test", version: "1" }, capabilities: { tools: {} } } });
    } else if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "broker_tool" }] } });
    } else if (message.method === "tools/call") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "broker result token=" + process.env.LOCAL_MCP_TOKEN }] } });
    }
  }
});
`,
      "utf8"
    );
    const server = {
      id: "brokered-stdio",
      name: "Brokered Stdio MCP",
      transport: "stdio" as const,
      enabled: true,
      command: process.execPath,
      args: [targetScript],
      env: { LOCAL_MCP_TOKEN: "broker-secret-value" },
    };
    await writeProjectMcpConfig(rootPath, [
      {
        ...server,
        trustedFingerprint: projectLocalMcpFingerprint(server),
      },
    ]);

    const service = new SessionMcpConfigService(createSettingsRepo());
    const [brokeredServer] = service.toAcpServers(
      await service.resolveServers(rootPath, {
        mcpCapabilities: {},
      })
    );
    if (!brokeredServer || "type" in brokeredServer) {
      throw new Error("Expected brokered stdio MCP server.");
    }
    const child = spawn(brokeredServer.command, brokeredServer.args ?? [], {
      cwd: rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    try {
      await requestJsonRpc(child, "initialize", {});
      const call = await requestJsonRpc(child, "tools/call", {
        name: "broker_tool",
        arguments: {},
      });
      expect(JSON.stringify(call)).toContain("[redacted]");
      expect(JSON.stringify(call)).not.toContain("broker-secret-value");

      const auditText = await readFile(
        path.join(rootPath, ".eragear", "mcp-agent-audit.jsonl"),
        "utf8"
      );
      expect(auditText).toContain("tools/call");
      expect(auditText).toContain("broker_tool");
      expect(auditText).toContain("[redacted]");
      expect(auditText).not.toContain("broker-secret-value");
    } finally {
      await closeChild(child);
    }
  });
});

async function expectBrokeredRemoteCall(params: {
  rootPath: string;
  transport: "streamable-http" | "sse";
  url: string;
  id: string;
  name: string;
}) {
  const server = {
    id: params.id,
    name: params.name,
    transport: params.transport,
    enabled: true,
    url: params.url,
    ...(params.transport === "sse" ? { messageEndpoint: "/messages" } : {}),
    headerEnv: { Authorization: "ERAGEAR_TEST_MCP_AUTH" },
  };
  await writeProjectMcpConfig(params.rootPath, [
    {
      ...server,
      trustedFingerprint: projectLocalMcpFingerprint(server),
    },
  ]);

  const service = new SessionMcpConfigService(createSettingsRepo());
  const [brokeredServer] = service.toAcpServers(
    await service.resolveServers(params.rootPath, {
      mcpCapabilities: {},
    })
  );
  if (!brokeredServer || "type" in brokeredServer) {
    throw new Error("Expected brokered remote MCP server.");
  }
  expect(brokeredServer.name).toBe(params.name);
  expect(brokeredServer.command).toBe(process.execPath);
  expect(brokeredServer.args).toContain(params.id);

  const child = spawn(brokeredServer.command, brokeredServer.args ?? [], {
    cwd: params.rootPath,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    await requestJsonRpc(child, "initialize", {});
    const call = await requestJsonRpc(child, "tools/call", {
      name: "remote_broker_tool",
      arguments: {},
    });
    expect(JSON.stringify(call)).toContain("[redacted]");
    expect(JSON.stringify(call)).not.toContain("Bearer remote-broker-secret");

    const auditText = await readFile(
      path.join(params.rootPath, ".eragear", "mcp-agent-audit.jsonl"),
      "utf8"
    );
    expect(auditText).toContain("tools/call");
    expect(auditText).toContain("remote_broker_tool");
    expect(auditText).toContain("[redacted]");
    expect(auditText).not.toContain("Bearer remote-broker-secret");
  } finally {
    await closeChild(child);
  }
}

test("brokers project-local streamable HTTP MCP calls through header env policy and redacted audit", async () => {
  await withProjectRoot(async (rootPath) => {
    const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
    process.env.ERAGEAR_TEST_MCP_AUTH = "Bearer remote-broker-secret";
    try {
      await withStreamableHttpMcpServer(async (url) => {
        await expectBrokeredRemoteCall({
          rootPath,
          transport: "streamable-http",
          url,
          id: "brokered-http",
          name: "Brokered HTTP MCP",
        });
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ERAGEAR_TEST_MCP_AUTH;
      } else {
        process.env.ERAGEAR_TEST_MCP_AUTH = previous;
      }
    }
  });
});

test("brokers project-local SSE MCP calls through header env policy and redacted audit", async () => {
  await withProjectRoot(async (rootPath) => {
    const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
    process.env.ERAGEAR_TEST_MCP_AUTH = "Bearer remote-broker-secret";
    try {
      await withSseMcpServer(async (url) => {
        await expectBrokeredRemoteCall({
          rootPath,
          transport: "sse",
          url,
          id: "brokered-sse",
          name: "Brokered SSE MCP",
        });
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ERAGEAR_TEST_MCP_AUTH;
      } else {
        process.env.ERAGEAR_TEST_MCP_AUTH = previous;
      }
    }
  });
});

test("does not inject untrusted or changed project-local MCP servers", async () => {
  await withProjectRoot(async (rootPath) => {
    const trustedThenChanged = {
      id: "changed",
      name: "Changed MCP",
      transport: "stdio" as const,
      enabled: true,
      command: "node",
      args: ["new-server.js"],
      trustedFingerprint: projectLocalMcpFingerprint({
        transport: "stdio" as const,
        command: "node",
        args: ["old-server.js"],
      }),
    };
    await writeProjectMcpConfig(rootPath, [
      {
        id: "untrusted",
        name: "Untrusted MCP",
        transport: "stdio",
        enabled: true,
        command: "node",
        args: ["server.js"],
      },
      trustedThenChanged,
    ]);

    const service = new SessionMcpConfigService(createSettingsRepo());

    await expect(service.resolveServers(rootPath, {})).resolves.toEqual([]);
  });
});

test("brokers project-local remote MCP header env without exposing secret values in ACP injection", async () => {
  await withProjectRoot(async (rootPath) => {
    const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
    process.env.ERAGEAR_TEST_MCP_AUTH = "Bearer resolved-token";
    try {
      const server = {
        id: "remote-http",
        name: "Remote HTTP MCP",
        transport: "streamable-http" as const,
        enabled: true,
        url: "https://mcp.example.test/messages",
        headerEnv: { Authorization: "ERAGEAR_TEST_MCP_AUTH" },
      };
      await writeProjectMcpConfig(rootPath, [
        {
          ...server,
          trustedFingerprint: projectLocalMcpFingerprint(server),
        },
      ]);

      const service = new SessionMcpConfigService(createSettingsRepo());
      const resolved = await service.resolveServers(rootPath, {
        mcpCapabilities: {},
      });

      expect(resolved).toEqual([
        {
          name: "Remote HTTP MCP",
          command: process.execPath,
          args: [
            expect.stringContaining("mcp-agent-broker.js"),
            "--project-root",
            rootPath,
            "--server-id",
            "remote-http",
            "--fingerprint",
            projectLocalMcpFingerprint(server),
          ],
          env: [],
        },
      ]);
      expect(JSON.stringify(resolved)).not.toContain("Bearer resolved-token");
    } finally {
      if (previous === undefined) {
        delete process.env.ERAGEAR_TEST_MCP_AUTH;
      } else {
        process.env.ERAGEAR_TEST_MCP_AUTH = previous;
      }
    }
  });
});

test("keeps project-local remote MCP transports out of ACP sessions when broker header env is missing", async () => {
  await withProjectRoot(async (rootPath) => {
    const previous = process.env.ERAGEAR_TEST_MCP_AUTH;
    delete process.env.ERAGEAR_TEST_MCP_AUTH;
    const server = {
      id: "remote-http",
      name: "Remote HTTP MCP",
      transport: "streamable-http" as const,
      enabled: true,
      url: "https://mcp.example.test/messages",
      headerEnv: { Authorization: "ERAGEAR_TEST_MCP_AUTH" },
    };
    try {
      await writeProjectMcpConfig(rootPath, [
        {
          ...server,
          trustedFingerprint: projectLocalMcpFingerprint(server),
        },
      ]);

      const service = new SessionMcpConfigService(createSettingsRepo());

      await expect(service.resolveServers(rootPath, {})).resolves.toEqual([]);
    } finally {
      if (previous !== undefined) {
        process.env.ERAGEAR_TEST_MCP_AUTH = previous;
      }
    }
  });
});
