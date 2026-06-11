import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LocalAdeService } from "./local-ade.service";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { ProjectRepositoryPort } from "@/modules/project";
import type { SessionRepositoryPort, SessionRuntimePort } from "@/modules/session";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { AgentConfig } from "@/shared/types/agent.types";
import type { Project } from "@/shared/types/project.types";

const userId = "local-test-user";
let tempRoot = "";
const execFileAsync = promisify(execFile);

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

function createService(agents: AgentConfig[] = []): LocalAdeService {
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
    getAll: () => [],
  } as unknown as SessionRuntimePort;
  const logStore: LogStorePort = {
    append: () => undefined,
    list: () => ({
      entries: [],
      stats: { total: 0, levels: { debug: 0, info: 0, warn: 0, error: 0 } },
    }),
    query: async () => ({
      entries: [],
      stats: { total: 0, levels: { debug: 0, info: 0, warn: 0, error: 0 } },
    }),
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
    }
  }
});
`,
    "utf8"
  );
  return scriptPath;
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

test("discovers project commands and persists disabled state", async () => {
  await mkdir(path.join(tempRoot, ".eragear", "commands"), {
    recursive: true,
  });
  await writeFile(
    path.join(tempRoot, ".eragear", "commands", "fix.md"),
    "---\nname: /fix\ndescription: Fix the current issue\n---\n# Fix\n",
    "utf8"
  );

  const service = createService();
  const snapshot = await service.snapshot(userId);
  const command = snapshot.capabilities.capabilities.find(
    (item) => item.kind === "command" && item.name === "/fix"
  );

  expect(command).toBeDefined();
  expect(command?.enabled).toBe(true);

  const updated = await service.updateCapabilityState(userId, {
    capabilityId: command?.id ?? "",
    enabled: false,
  });
  const disabled = updated.capabilities.capabilities.find(
    (item) => item.id === command?.id
  );
  const state = JSON.parse(
    await readFile(
      path.join(tempRoot, ".eragear", "capabilities-state.json"),
      "utf8"
    )
  );

  expect(disabled?.enabled).toBe(false);
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
  expect(server?.diagnostics.join("\n")).toContain("MCP initialize succeeded");
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

  const service = createService();
  const updated = await service.createCheckpoint(userId, {
    name: "Unit checkpoint",
  });
  const checkpoint = updated.checkpoints.items[0];
  const patch = await readFile(checkpoint?.patchPath ?? "", "utf8");
  const preview = await service.previewCheckpoint(userId, {
    checkpointId: checkpoint?.id ?? "",
  });

  expect(checkpoint?.name).toBe("Unit checkpoint");
  expect(checkpoint?.changedFiles).toContain("README.md");
  expect(checkpoint?.patchBytes).toBeGreaterThan(0);
  expect(patch).toContain("+changed");
  expect(preview.preview).toContain("+changed");
  expect(preview.canRestore).toBe(true);
  expect(preview.restoreBlockers).toEqual([]);

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
  const restoredReadme = await readFile(path.join(tempRoot, "README.md"), "utf8");

  expect(restoredReadme.replace(/\r\n/g, "\n")).toBe("initial\n");
  expect(restoredCheckpoint?.restoredAt).toBeDefined();
  expect(restoredCheckpoint?.canRestore).toBe(false);
  expect(restoredCheckpoint?.preRestoreSafetyCheckpointId).toBe(
    safetyCheckpoint?.id
  );
  expect(safetyCheckpoint?.restoreMode).toBe("apply-patch");
  expect(safetyCheckpoint?.canRestore).toBe(true);

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
});
