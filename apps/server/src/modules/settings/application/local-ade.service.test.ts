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

test("probes stdio MCP entries with an executable command", async () => {
  const service = createService();

  const updated = await service.upsertMcpServer(userId, {
    name: "Local runtime probe",
    transport: "stdio",
    command: process.execPath,
    enabled: true,
  });
  const server = updated.mcp.servers.find(
    (item) => item.name === "Local runtime probe"
  );

  expect(server).toBeDefined();
  expect(server?.health).toBe("available");
  expect(server?.latencyMs).toBeGreaterThanOrEqual(0);
  expect(server?.diagnostics.join("\n")).toContain("Executable exists");
});

test("tests provider command and persists redacted health metadata", async () => {
  const agent: AgentConfig = {
    id: "agent-1",
    userId,
    name: "Runtime Agent",
    type: "other",
    command: process.execPath,
    args: [],
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

  expect(provider?.status).toBe("available");
  expect(provider?.redactedEnvKeys).toEqual(["TEST_SECRET_KEY"]);
  expect(provider?.version).toBeDefined();
  expect(stored.providers["provider.agent.agent-1"].status).toBe("available");
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
  const restoredReadme = await readFile(path.join(tempRoot, "README.md"), "utf8");

  expect(restoredReadme.replace(/\r\n/g, "\n")).toBe("initial\n");
  expect(restoredCheckpoint?.restoredAt).toBeDefined();
  expect(restoredCheckpoint?.canRestore).toBe(false);
});
