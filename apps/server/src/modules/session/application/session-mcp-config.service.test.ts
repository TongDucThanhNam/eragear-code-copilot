import { spawn } from "node:child_process";
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

test("resolves project-local remote MCP header env values before ACP injection", async () => {
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
        mcpCapabilities: { http: true },
      });

      expect(resolved).toEqual([
        {
          type: "http",
          name: "Remote HTTP MCP",
          url: "https://mcp.example.test/messages",
          headers: [
            { name: "Authorization", value: "Bearer resolved-token" },
          ],
        },
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.ERAGEAR_TEST_MCP_AUTH;
      } else {
        process.env.ERAGEAR_TEST_MCP_AUTH = previous;
      }
    }
  });
});

test("keeps unsupported trusted project-local remote MCP transports out of ACP sessions", async () => {
  await withProjectRoot(async (rootPath) => {
    const server = {
      id: "remote-http",
      name: "Remote HTTP MCP",
      transport: "streamable-http" as const,
      enabled: true,
      url: "https://mcp.example.test/messages",
    };
    await writeProjectMcpConfig(rootPath, [
      {
        ...server,
        trustedFingerprint: projectLocalMcpFingerprint(server),
      },
    ]);

    const service = new SessionMcpConfigService(createSettingsRepo());

    await expect(service.resolveServers(rootPath, {})).rejects.toThrow(
      "Agent does not support MCP transports for: Remote HTTP MCP"
    );
  });
});
