import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RuntimeServiceOperation } from "@repo/shared";
import { DesktopRuntimeHost } from "../src/runtime-host.js";

interface ProjectSummary {
  id: string;
  name: string;
  path: string;
}

interface ProjectListResult {
  projects: ProjectSummary[];
  activeProjectId: string | null;
}

interface AgentSummary {
  id: string;
  name: string;
  type: string;
  command: string;
  args?: string[];
}

interface AgentListResult {
  agents: AgentSummary[];
  activeAgentId: string | null;
}

interface SessionCreateResult {
  chatId: string;
  sessionId?: string | null;
  chatStatus?: string;
}

interface SessionStateResult {
  status: string;
  chatStatus: string;
  agentInfo?: {
    name?: string;
    title?: string;
  } | null;
}

interface CapabilitySummary {
  kind: string;
  name: string;
  enabled: boolean;
  sourcePath?: string;
}

interface CheckpointSessionAttribution {
  chatId: string;
  source: "active" | "stored" | "missing";
  status: string;
  messageCount: number;
  sessionId?: string;
  agentName?: string;
  activeTurnId?: string;
  lastCompletedTurnId?: string;
}

interface LocalAdeSnapshot {
  projectRoot: string;
  providers: Array<{
    id: string;
    status: string;
    cliStatus?: string;
    authStatus?: string;
    modelStatus?: string;
    version?: string;
    modelList?: string[];
    diagnostics?: string[];
  }>;
  mcp: {
    configPath: string;
    agentRouting: {
      status: "ready" | "attention" | "empty";
      injectableCount: number;
      conditionalCount: number;
      blockedCount: number;
      skippedCount: number;
      routes: Array<{
        serverId: string;
        serverName: string;
        transport: "stdio" | "sse" | "streamable-http";
        status: "injectable" | "conditional" | "blocked" | "skipped";
        reason: string;
        brokerMode: "stdio-proxy" | "native-agent-transport" | "none";
        requiresAgentCapability?: "http" | "sse";
        agentSupport: "not-required" | "required-at-session-start";
        agentInvocationCount: number;
        lastAgentInvocation?: {
          method: "tools/call" | "resources/read";
          target: string;
          status: "success" | "failed";
          resultText?: string;
          error?: string;
        };
        headerEnv: Array<{ header: string; envKey: string; present: boolean }>;
      }>;
      agentInvocationHistory: Array<{
        serverId: string;
        method: "tools/call" | "resources/read";
        target: string;
        status: "success" | "failed";
        resultText?: string;
        error?: string;
      }>;
      diagnostics: string[];
    };
    servers: Array<{
      id: string;
      name: string;
      transport: "stdio" | "sse" | "streamable-http";
      enabled: boolean;
      health: string;
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      trustedAt?: string;
      protocol: {
        status: string;
        toolsDiscovered: number;
        resourcesDiscovered: number;
      };
      headerEnv: Array<{ header: string; envKey: string; present: boolean }>;
      probe: {
        status: string;
        retryable: boolean;
        stepCount: number;
        failedStepCount: number;
        steps: Array<{
          step: string;
          status: string;
          latencyMs: number;
          detail?: string;
          error?: string;
        }>;
      };
      probeHistory: Array<{
        id: string;
        status: string;
        protocolStatus: string;
        durationMs: number;
        stepCount: number;
        failedStepCount: number;
        toolsDiscovered: number;
        resourcesDiscovered: number;
        steps: Array<{ step: string; status: string }>;
      }>;
      invocationHistory: Array<{
        method: "tools/call" | "resources/read";
        target: string;
        status: "success" | "failed";
        resultText: string;
        finishedAt: string;
        durationMs: number;
      }>;
      notificationHistory: Array<{
        source: "probe" | "invocation";
        method: string;
        payloadText: string;
        receivedAt: string;
        truncated: boolean;
      }>;
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string; name?: string }>;
    }>;
  };
  checkpoints: {
    items: Array<{
      id: string;
      patchBytes: number;
      sessionAttributions: CheckpointSessionAttribution[];
      changedFiles: string[];
      partialRestores?: Array<{
        restoredAt: string;
        files: string[];
        hunks?: Array<{ file: string; hunkIndex: number; header: string }>;
        safetyCheckpointId?: string;
      }>;
      safetyForCheckpointId?: string;
    }>;
  };
  capabilities: {
    capabilities: CapabilitySummary[];
  };
  commands: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    argumentHint?: string;
    sourcePath: string;
  }>;
  skills: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    sourcePath: string;
  }>;
  outputStyles: Array<{
    name: string;
    enabled: boolean;
    prompt: string;
    sourcePath: string;
  }>;
  acpActivity: {
    entries: Array<{
      id: string;
      message: string;
      chatId?: string;
      kind?: string;
      payloadBytes?: number;
      metadata: Record<string, string | number | boolean | null>;
    }>;
    correlations: Array<{
      key: string;
      label: string;
      eventCount: number;
      firstTimestamp: number;
      lastTimestamp: number;
      durationMs: number;
      latestMessage: string;
      latestLevel: string;
      chatId?: string;
      sessionId?: string;
      turnId?: string;
      levels: Record<string, number>;
      kinds: Record<string, number>;
    }>;
    stats: {
      total: number;
      chatCount: number;
      kinds: Record<string, number>;
    };
    diagnostics: string[];
  };
  projectIndex: {
    storagePath: string;
    indexedAt?: string;
    indexedFiles: number;
    totalBytes: number;
    extensions: Array<{ extension: string; count: number }>;
    files: Array<{ path: string; sizeBytes: number; extension: string }>;
    symbols: Array<{ path: string; name: string; kind: string; line: number }>;
    tasks: Array<{ path: string; marker: string; line: number; text: string }>;
  };
  hooks: {
    configPath: string;
    items: Array<{
      id: string;
      name: string;
      event: string;
      enabled: boolean;
      envKeys: string[];
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      lastRun?: {
        status: string;
        stdout: string;
        stderr: string;
      };
    }>;
    recentRuns: Array<{ hookId: string; status: string }>;
  };
  plugins: {
    configPath: string;
    items: Array<{
      id: string;
      name: string;
      enabled: boolean;
      scopes: Array<"process" | "project-root" | "env">;
      envKeys: string[];
      fingerprint: string;
      trustStatus: "trusted" | "untrusted" | "changed";
      trustedFingerprint?: string;
      lastRun?: {
        status: string;
        stdout: string;
        stderr: string;
      };
    }>;
    recentRuns: Array<{ pluginId: string; status: string }>;
  };
  projectMemory: {
    sources: Array<{ id: string; relativePath: string; enabled: boolean }>;
  };
  subagents: Array<{
    name: string;
    description?: string;
    enabled: boolean;
    sourcePath: string;
    prompt: string;
  }>;
  blockers: Array<{ workflow: string }>;
}

interface McpInvocationResult {
  serverId: string;
  serverName: string;
  transport: "stdio" | "sse" | "streamable-http";
  method: "tools/call" | "resources/read";
  target: string;
  status: "success" | "failed";
  isError: boolean;
  resultText: string;
  resultJson: string;
  diagnostics: string[];
  content: Array<{
    type: string;
    text?: string;
    uri?: string;
    mimeType?: string;
  }>;
}

interface ProjectIndexSearchResult {
  status: "ready" | "not-indexed" | "no-results";
  query: string;
  results: Array<{
    type: string;
    path: string;
    title: string;
    detail: string;
  }>;
  prompt: string;
  diagnostics: string[];
}

interface ProjectMemoryContextResult {
  status: "ready" | "no-enabled-sources";
  query: string;
  sources: Array<{
    id: string;
    relativePath: string;
    includedBytes: number;
    truncated: boolean;
  }>;
  prompt: string;
  diagnostics: string[];
}

interface AcpActivityExportResult {
  schemaVersion: 1;
  exportedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    limit: number;
  };
  redacted: true;
  entries: Array<{
    id: string;
    message: string;
    chatId?: string;
    kind?: string;
    payloadBytes?: number;
    metadata: Record<string, string | number | boolean | null>;
  }>;
  correlations: Array<{
    key: string;
    label: string;
    eventCount: number;
    firstTimestamp: number;
    lastTimestamp: number;
    durationMs: number;
    latestMessage: string;
    latestLevel: string;
    chatId?: string;
    sessionId?: string;
    turnId?: string;
    levels: Record<string, number>;
    kinds: Record<string, number>;
  }>;
  stats: {
    total: number;
    chatCount: number;
    kinds: Record<string, number>;
  };
  diagnostics: string[];
}

interface AcpActivityReplayResult {
  schemaVersion: 1;
  replayedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    correlationKey?: string;
    limit: number;
  };
  redacted: true;
  frames: Array<{
    id: string;
    sequence: number;
    timestamp: number;
    elapsedMs: number;
    deltaMs: number;
    level: string;
    message: string;
    chatId?: string;
    kind?: string;
    payloadBytes?: number;
    correlationKey: string;
    correlationLabel: string;
    metadata: Record<string, string | number | boolean | null>;
  }>;
  correlations: Array<{
    key: string;
    label: string;
    eventCount: number;
    chatId?: string;
    sessionId?: string;
    turnId?: string;
  }>;
  stats: {
    total: number;
    chatCount: number;
    kinds: Record<string, number>;
  };
  diagnostics: string[];
}

interface CheckpointPreviewResult {
  checkpointId: string;
  canRestore: boolean;
  restoreToken: string;
  sessionAttributions: CheckpointSessionAttribution[];
  diffFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    hunks: Array<{
      rows: Array<{
        kind: string;
        oldText?: string;
        newText?: string;
      }>;
    }>;
  }>;
  restoreRisks: Array<{
    file: string;
    level: "safe" | "warning" | "blocked";
    patchAction: string;
    reason: string;
  }>;
  restoreBlockers: Array<{ file: string; reason: string }>;
}

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const smokeMcpScript = path.join(desktopRoot, "scripts", "mcp-smoke-server.js");
const acpMcpCaptureAgentScript = path.join(
  desktopRoot,
  "scripts",
  "acp-mcp-capture-agent.js"
);
const smokeCommandPath = path.join(
  repoRoot,
  ".eragear",
  "commands",
  "desktop-smoke.md"
);
const smokeSkillPath = path.join(
  repoRoot,
  ".eragear",
  "skills",
  "desktop-smoke",
  "SKILL.md"
);
const smokeOutputStylePath = path.join(
  repoRoot,
  ".eragear",
  "output-styles",
  "desktop-smoke.md"
);
const smokeMemoryPath = path.join(repoRoot, ".eragear", "context.md");
const repoIndexPath = path.join(repoRoot, ".eragear", "repo-index.json");
const capabilitiesStatePath = path.join(
  repoRoot,
  ".eragear",
  "capabilities-state.json"
);
const providerHealthPath = path.join(repoRoot, ".eragear", "provider-health.json");
const hooksPath = path.join(repoRoot, ".eragear", "hooks.json");
const pluginsPath = path.join(repoRoot, ".eragear", "plugins.json");
const token = `smoke-${Date.now()}`;
const promptWaitMs = Number(process.env.ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS ?? 20_000);
const execFileAsync = promisify(execFile);

const host = new DesktopRuntimeHost({
  mode: "main-thread",
  repoRoot,
  rendererUrl: "http://127.0.0.1:3001",
  runtimePort: 443,
  localAuthToken: token,
  remoteRuntimeUrl: "",
});

let sequence = 1;

function operation(
  type: RuntimeServiceOperation["type"],
  rpcPath: string,
  input?: unknown
): RuntimeServiceOperation {
  return {
    id: sequence++,
    type,
    path: rpcPath,
    input,
  };
}

function smokeSubagentSlashCommandName(name: string): string {
  return `agent-${name
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function resolveSmokeSubagentCommand(params: {
  text: string;
  subagents: LocalAdeSnapshot["subagents"];
}): { command: string; prompt: string; sourcePath: string } | null {
  const leadingCommand = params.text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!leadingCommand) {
    return null;
  }

  const commandName = leadingCommand[1];
  if (!commandName) {
    return null;
  }
  const subagent = params.subagents.find(
    (item) =>
      item.enabled && smokeSubagentSlashCommandName(item.name) === commandName
  );
  if (!subagent) {
    return null;
  }

  const request =
    leadingCommand[2]?.trim() ||
    "Review the current project state and report findings.";
  return {
    command: commandName,
    sourcePath: subagent.sourcePath,
    prompt: [
      `Delegate this task to the "${subagent.name}" subagent profile.`,
      subagent.description ? `Subagent description: ${subagent.description}` : "",
      `Subagent source: ${subagent.sourcePath}`,
      "",
      "Subagent instructions:",
      subagent.prompt,
      "",
      "User request:",
      request,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  };
}

async function request<T>(runtimeOperation: RuntimeServiceOperation): Promise<T> {
  const response = await host.requestOperation({
    auth: { localAuthToken: token },
    operation: runtimeOperation,
  });
  if (!response.ok) {
    throw new Error(JSON.stringify(response.error));
  }
  return response.data as T;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJsonFile<T>(
  filePath: string,
  timeoutMs = 5000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      lastError = error;
      await wait(150);
    }
  }
  throw new Error(
    `Timed out waiting for JSON file ${filePath}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function requestStdioJsonRpc(params: {
  command: string;
  args: string[];
  cwd: string;
  method: string;
  rpcParams?: unknown;
}): Promise<Record<string, unknown>> {
  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  const id = `desktop-smoke-${Date.now()}-${Math.random()}`;
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP ${params.method}`));
      }, 6000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.stdout.on("data", (chunk) => {
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
          resolve(message);
        }
      });
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: params.method,
          ...(params.rpcParams === undefined ? {} : { params: params.rpcParams }),
        })}\n`
      );
    });
  } finally {
    child.kill();
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function restoreOptionalFile(
  filePath: string,
  previous: string | null
): Promise<void> {
  if (previous === null) {
    await rm(filePath, { force: true }).catch(() => undefined);
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, previous, "utf8");
}

async function waitForHookRun(
  hookId: string,
  stdoutNeedle: string,
  timeoutMs = 8000
): Promise<NonNullable<LocalAdeSnapshot["hooks"]["items"][number]["lastRun"]>> {
  const deadline = Date.now() + timeoutMs;
  let lastRun:
    | NonNullable<LocalAdeSnapshot["hooks"]["items"][number]["lastRun"]>
    | undefined;
  while (Date.now() < deadline) {
    const snapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    lastRun = snapshot.hooks.items.find((hook) => hook.id === hookId)?.lastRun;
    if (lastRun?.status === "success" && lastRun.stdout.includes(stdoutNeedle)) {
      return lastRun;
    }
    await wait(250);
  }
  throw new Error(
    `Timed out waiting for hook ${hookId}; last status ${lastRun?.status ?? "missing"} stdout ${lastRun?.stdout ?? ""}`
  );
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
  const expectedAuthorization = process.env.ERAGEAR_DESKTOP_MCP_AUTH;
  const clients = new Set<ServerResponse>();
  const requestCounts: Record<string, number> = {};
  let firstRequestStreamClosed = false;
  let methodStreamClosed = false;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/sse") {
      if (
        expectedAuthorization &&
        request.headers.authorization !== expectedAuthorization
      ) {
        response
          .writeHead(401, { "content-type": "text/plain" })
          .end(`missing ${expectedAuthorization}`);
        return;
      }
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
      if (
        expectedAuthorization &&
        request.headers.authorization !== expectedAuthorization
      ) {
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
            serverInfo: { name: "desktop-smoke-sse", version: "1.0.0" },
            capabilities: { tools: {}, resources: {} },
          };
        } else if (message.method === "tools/list") {
          result = {
            tools: [
              {
                name: "desktop_smoke_sse_tool",
                description: "Desktop smoke SSE tool",
              },
            ],
          };
        } else if (message.method === "resources/list") {
          result = {
            resources: [
              { uri: "memory://desktop-smoke-sse", name: "desktop-sse-resource" },
            ],
          };
        } else if (message.method === "tools/call") {
          result = {
            content: [
              {
                type: "text",
                text: `desktop sse tool ${message.params.name} authorization=${request.headers.authorization ?? ""}`,
              },
            ],
          };
        } else if (message.method === "resources/read") {
          result = {
            contents: [
              {
                uri: message.params.uri,
                mimeType: "text/plain",
                text: `desktop sse resource ${message.params.uri}`,
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
            data: `desktop sse ${message.method} authorization=${request.headers.authorization ?? ""}`,
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

async function ensureRepoProject(): Promise<ProjectSummary> {
  const projectsData = await request<ProjectListResult>(
    operation("query", "listProjects")
  );
  let project = projectsData.projects.find(
    (item) => path.resolve(item.path).toLowerCase() === repoRoot.toLowerCase()
  );
  if (!project) {
    project = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Eragear Code Copilot",
        path: repoRoot,
        description: "Desktop IPC smoke project",
        tags: ["desktop-smoke"],
      })
    );
  }
  await request<unknown>(
    operation("mutation", "setActiveProject", { id: project.id })
  );
  return project;
}

async function chooseAgent(): Promise<AgentSummary> {
  const agentsData = await request<AgentListResult>(
    operation("query", "agents.list")
  );
  const agent =
    agentsData.agents.find((item) => item.type === "opencode") ??
    agentsData.agents.find((item) => item.type === "codex") ??
    agentsData.agents.find((item) => item.id === agentsData.activeAgentId) ??
    agentsData.agents[0];
  if (!agent) {
    throw new Error("No agent configuration available for desktop smoke.");
  }
  return agent;
}

async function resolveCliCommand(command: string): Promise<string | null> {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookupCommand, [command], {
      timeout: 5000,
      windowsHide: true,
    });
    return (
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

async function withCodexProviderAgent<T>(
  run: (agent: AgentSummary, created: boolean) => Promise<T>
): Promise<T | null> {
  const agentsData = await request<AgentListResult>(
    operation("query", "agents.list")
  );
  const existing = agentsData.agents.find((item) => item.type === "codex");
  if (existing) {
    return await run(existing, false);
  }

  const codexCommand = await resolveCliCommand("codex");
  if (!codexCommand) {
    console.log(
      "CODEX_PROVIDER_DOCTOR",
      JSON.stringify({ skipped: "codex cli missing" })
    );
    return null;
  }
  const agentCommand = /\s/.test(codexCommand) ? "codex" : codexCommand;
  const previousProviderHealth = await readOptionalFile(providerHealthPath);

  const created = await request<AgentSummary>(
    operation("mutation", "agents.create", {
      name: "Desktop Smoke Codex Provider",
      type: "codex",
      command: agentCommand,
      args: ["acp"],
      env: {},
      projectId: null,
    })
  );
  try {
    return await run(created, true);
  } finally {
    await request<unknown>(
      operation("mutation", "agents.delete", { id: created.id })
    ).catch((error) => {
      console.log(
        "CODEX_PROVIDER_DOCTOR_CLEANUP_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    });
    await restoreOptionalFile(providerHealthPath, previousProviderHealth).catch(
      (error) => {
        console.log(
          "CODEX_PROVIDER_HEALTH_RESTORE_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }
    );
  }
}

async function testCodexProviderDoctor(): Promise<void> {
  await withCodexProviderAgent(async (codexAgent, created) => {
    const providerSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.testProvider", {
        providerId: `provider.agent.${codexAgent.id}`,
      })
    );
    const provider = providerSnapshot.providers.find(
      (item) => item.id === `provider.agent.${codexAgent.id}`
    );
    console.log(
      "CODEX_PROVIDER_DOCTOR",
      JSON.stringify({
        id: codexAgent.id,
        temporary: created,
        command: codexAgent.command,
        args: codexAgent.args ?? [],
        status: provider?.status ?? "missing",
        cliStatus: provider?.cliStatus ?? "missing",
        authStatus: provider?.authStatus ?? "missing",
        modelStatus: provider?.modelStatus ?? "missing",
        modelList: provider?.modelList ?? [],
        diagnostics: provider?.diagnostics?.slice(-8) ?? [],
        doctor:
          provider?.diagnostics?.some((item) =>
            item.includes("Codex doctor overall status")
          ) ?? false,
      })
    );
    if (!provider) {
      throw new Error("Codex provider descriptor was missing after readiness probe.");
    }
    if (provider.cliStatus !== "ok") {
      throw new Error("Codex provider CLI probe did not report ok.");
    }
    if (
      provider.authStatus === "ok" &&
      (!provider.diagnostics?.some((item) =>
        item.includes("Codex doctor overall status")
      ) ||
        provider.modelStatus !== "ok" ||
        (provider.modelList?.length ?? 0) === 0)
    ) {
      throw new Error("Codex provider doctor probe did not classify model readiness.");
    }
  });
}

async function withFileBackup<T>(
  filePath: string,
  run: () => Promise<T>
): Promise<T> {
  let previous: string | null = null;
  try {
    previous = await readFile(filePath, "utf8");
  } catch {
    previous = null;
  }
  try {
    return await run();
  } finally {
    if (previous === null) {
      await rm(filePath, { force: true }).catch(() => undefined);
    } else {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, previous, "utf8");
    }
  }
}

async function runCheckpointRiskSmoke(
  repoProjectId: string,
  agentId: string
): Promise<void> {
  try {
    await execFileAsync("git", ["--version"], { windowsHide: true });
  } catch {
    console.log("CHECKPOINT_RISK", JSON.stringify({ skipped: "git missing" }));
    return;
  }

  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-smoke-")
  );
  let tempProject: ProjectSummary | null = null;
  let checkpointChatId: string | null = null;
  try {
    await execFileAsync("git", ["init"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.email", "desktop-smoke@example.test"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["config", "user.name", "Desktop Smoke"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(path.join(tempProjectRoot, "README.md"), "initial\n", "utf8");
    await writeFile(path.join(tempProjectRoot, "NOTES.md"), "notes\n", "utf8");
    const hunkBaseLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    await writeFile(
      path.join(tempProjectRoot, "HUNKS.md"),
      `${hunkBaseLines.join("\n")}\n`,
      "utf8"
    );
    await execFileAsync("git", ["add", "README.md", "NOTES.md", "HUNKS.md"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await execFileAsync("git", ["commit", "-m", "initial"], {
      cwd: tempProjectRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(tempProjectRoot, "README.md"),
      "initial\nchanged\n",
      "utf8"
    );
    await writeFile(
      path.join(tempProjectRoot, "NOTES.md"),
      "notes\nchanged\n",
      "utf8"
    );
    const hunkChangedLines = [...hunkBaseLines];
    hunkChangedLines[1] = "line 2 changed";
    hunkChangedLines[17] = "line 18 changed";
    await writeFile(
      path.join(tempProjectRoot, "HUNKS.md"),
      `${hunkChangedLines.join("\n")}\n`,
      "utf8"
    );
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke Checkpoint",
        path: tempProjectRoot,
        description: "Temporary checkpoint risk project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const checkpointSession = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: tempProject.id,
        agentId,
      })
    );
    checkpointChatId = checkpointSession.chatId;
    const checkpointSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.createCheckpoint", {
        name: "Desktop Smoke Checkpoint",
      })
    );
    const checkpoint = checkpointSnapshot.checkpoints.items[0];
    if (!checkpoint) {
      throw new Error("Desktop smoke checkpoint was not created.");
    }
    const checkpointAttribution = checkpoint.sessionAttributions.find(
      (item) => item.chatId === checkpointChatId
    );
    const preview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const previewAttribution = preview.sessionAttributions.find(
      (item) => item.chatId === checkpointChatId
    );
    const readmeDiff = preview.diffFiles.find((file) => file.path === "README.md");
    const hasChangedAddition =
      readmeDiff?.hunks.some((hunk) =>
        hunk.rows.some(
          (row) => row.kind === "add" && row.newText === "changed"
        )
      ) ?? false;
    const hunkDiff = preview.diffFiles.find((file) => file.path === "HUNKS.md");
    const safeRisk = preview.restoreRisks.find(
      (risk) => risk.file === "README.md"
    );
    await writeFile(path.join(tempProjectRoot, "EXTRA.md"), "conflict\n", "utf8");
    const conflictPreview = await request<CheckpointPreviewResult>(
      operation("mutation", "settings.previewCheckpoint", {
        checkpointId: checkpoint.id,
      })
    );
    const blockedRisk = conflictPreview.restoreRisks.find(
      (risk) => risk.file === "EXTRA.md"
    );
    const hunkRestore = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpointHunks", {
        checkpointId: checkpoint.id,
        confirmation: preview.restoreToken,
        hunks: [{ file: "HUNKS.md", hunkIndex: 0 }],
      })
    );
    const hunkCheckpoint = hunkRestore.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const hunkSafetyCheckpoint = hunkRestore.checkpoints.items.find(
      (item) => item.id === hunkCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
    );
    const afterHunkRestore = (
      await readFile(path.join(tempProjectRoot, "HUNKS.md"), "utf8")
    )
      .replace(/\r\n/g, "\n")
      .split("\n");
    const selectedRestore = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.restoreCheckpointFiles", {
        checkpointId: checkpoint.id,
        confirmation: preview.restoreToken,
        files: ["README.md"],
      })
    );
    const selectedCheckpoint = selectedRestore.checkpoints.items.find(
      (item) => item.id === checkpoint.id
    );
    const selectedSafetyCheckpoint = selectedRestore.checkpoints.items.find(
      (item) => item.id === selectedCheckpoint?.partialRestores?.[0]?.safetyCheckpointId
    );
    const restoredReadme = await readFile(
      path.join(tempProjectRoot, "README.md"),
      "utf8"
    );
    const untouchedNotes = await readFile(
      path.join(tempProjectRoot, "NOTES.md"),
      "utf8"
    );
    const untouchedExtra = await readFile(
      path.join(tempProjectRoot, "EXTRA.md"),
      "utf8"
    );
    const hunkAfterFileRestore = (
      await readFile(path.join(tempProjectRoot, "HUNKS.md"), "utf8")
    )
      .replace(/\r\n/g, "\n")
      .split("\n");
    console.log(
      "CHECKPOINT_RISK",
      JSON.stringify({
        checkpointId: checkpoint.id,
        initialCanRestore: preview.canRestore,
        safeRisk: safeRisk?.level ?? "missing",
        attributionSource: previewAttribution?.source ?? "missing",
        attributionStatus: previewAttribution?.status ?? "missing",
        attributionMessages: previewAttribution?.messageCount ?? -1,
        diffFiles: preview.diffFiles.length,
        diffStatus: readmeDiff?.status ?? "missing",
        diffAdditions: readmeDiff?.additions ?? -1,
        diffHasChangedAddition: hasChangedAddition,
        hunkDiffCount: hunkDiff?.hunks.length ?? -1,
        conflictCanRestore: conflictPreview.canRestore,
        blockedRisk: blockedRisk?.level ?? "missing",
        blockers: conflictPreview.restoreBlockers.length,
        selectedHunkRestores:
          hunkCheckpoint?.partialRestores?.[0]?.hunks?.length ?? -1,
        selectedHunkSafetyFiles: hunkSafetyCheckpoint?.changedFiles.length ?? -1,
        selectedHunkFirstRestored: afterHunkRestore[1] === "line 2",
        selectedHunkSecondPreserved: afterHunkRestore[17] === "line 18 changed",
        selectedRestoreFiles:
          selectedCheckpoint?.partialRestores?.[0]?.files.length ?? -1,
        selectedSafetyFiles: selectedSafetyCheckpoint?.changedFiles.length ?? -1,
        selectedReadmeRestored:
          restoredReadme.replace(/\r\n/g, "\n") === "initial\n",
        selectedNotesPreserved:
          untouchedNotes.replace(/\r\n/g, "\n") === "notes\nchanged\n",
        selectedExtraPreserved:
          untouchedExtra.replace(/\r\n/g, "\n") === "conflict\n",
        selectedHunkPreservedAfterFileRestore:
          hunkAfterFileRestore[1] === "line 2" &&
          hunkAfterFileRestore[17] === "line 18 changed",
      })
    );
    if (
      !preview.canRestore ||
      safeRisk?.level !== "safe" ||
      checkpointAttribution?.source !== "active" ||
      previewAttribution?.source !== "active" ||
      readmeDiff?.status !== "modified" ||
      readmeDiff.additions < 1 ||
      !hasChangedAddition ||
      hunkDiff?.hunks.length !== 2 ||
      conflictPreview.canRestore ||
      blockedRisk?.level !== "blocked" ||
      conflictPreview.restoreBlockers.length === 0 ||
      hunkCheckpoint?.partialRestores?.[0]?.hunks?.[0]?.file !== "HUNKS.md" ||
      hunkCheckpoint?.partialRestores?.[0]?.hunks?.[0]?.hunkIndex !== 0 ||
      hunkSafetyCheckpoint?.changedFiles[0] !== "HUNKS.md" ||
      afterHunkRestore[1] !== "line 2" ||
      afterHunkRestore[17] !== "line 18 changed" ||
      selectedCheckpoint?.partialRestores?.[0]?.files[0] !== "README.md" ||
      selectedSafetyCheckpoint?.changedFiles[0] !== "README.md" ||
      restoredReadme.replace(/\r\n/g, "\n") !== "initial\n" ||
      untouchedNotes.replace(/\r\n/g, "\n") !== "notes\nchanged\n" ||
      untouchedExtra.replace(/\r\n/g, "\n") !== "conflict\n" ||
      hunkAfterFileRestore[1] !== "line 2" ||
      hunkAfterFileRestore[17] !== "line 18 changed"
    ) {
      throw new Error("Desktop smoke checkpoint restore risk preview failed.");
    }
  } finally {
    if (checkpointChatId) {
      await request<unknown>(
        operation("mutation", "stopSession", { chatId: checkpointChatId })
      ).catch(() => undefined);
    }
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function runMcpSessionInjectionSmoke(repoProjectId: string): Promise<void> {
  const tempProjectRoot = await mkdtemp(
    path.join(os.tmpdir(), "eragear-mcp-session-smoke-")
  );
  const capturePath = path.join(tempProjectRoot, "mcp-session-capture.json");
  let tempProject: ProjectSummary | null = null;
  let tempAgent: AgentSummary | null = null;
  let mcpChatId: string | null = null;
  try {
    await writeFile(path.join(tempProjectRoot, "README.md"), "mcp session\n", "utf8");
    tempProject = await request<ProjectSummary>(
      operation("mutation", "createProject", {
        name: "Desktop Smoke MCP Session",
        path: tempProjectRoot,
        description: "Temporary MCP session injection project",
        tags: ["desktop-smoke"],
      })
    );
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: tempProject.id })
    );
    const mcpSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertMcpServer", {
        projectId: tempProject.id,
        id: "desktop-session-injected-mcp",
        name: "Desktop Session Injected MCP",
        transport: "stdio",
        enabled: true,
        command: process.execPath,
        args: [smokeMcpScript],
      })
    );
    const mcpServer = mcpSnapshot.mcp.servers.find(
      (server) => server.id === "desktop-session-injected-mcp"
    );
    if (!mcpServer) {
      throw new Error("Desktop smoke MCP session server was not created.");
    }
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustMcpServer", {
        projectId: tempProject.id,
        serverId: mcpServer.id,
        fingerprint: mcpServer.fingerprint,
      })
    );
    tempAgent = await request<AgentSummary>(
      operation("mutation", "agents.create", {
        name: "Desktop MCP Capture Agent",
        type: "other",
        command: process.execPath,
        args: [acpMcpCaptureAgentScript, capturePath],
        env: {},
        projectId: tempProject.id,
      })
    );
    const session = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: tempProject.id,
        agentId: tempAgent.id,
      })
    );
    mcpChatId = session.chatId;
    const capture = await waitForJsonFile<{
      method: string;
      cwd?: string;
      mcpServers: Array<{
        name?: string;
        command?: string;
        args?: string[];
      }>;
    }>(capturePath);
    console.log(
      "MCP_SESSION_INJECTION",
      JSON.stringify({
        method: capture.method,
        cwd: capture.cwd,
        serverCount: capture.mcpServers.length,
        servers: capture.mcpServers.map((server) => [
          server.name ?? null,
          server.command ?? null,
          server.args ?? [],
        ]),
      })
    );
    if (
      capture.method !== "session/new" ||
      capture.cwd !== tempProjectRoot ||
      capture.mcpServers.length !== 1 ||
      capture.mcpServers[0]?.name !== "Desktop Session Injected MCP" ||
      capture.mcpServers[0]?.command !== process.execPath ||
      !capture.mcpServers[0]?.args?.some((arg) =>
        arg.includes("mcp-agent-broker.js")
      ) ||
      !capture.mcpServers[0]?.args?.includes("--server-id") ||
      !capture.mcpServers[0]?.args?.includes("desktop-session-injected-mcp")
    ) {
      throw new Error("Desktop smoke MCP server was not injected into ACP newSession.");
    }
    const brokerCall = await requestStdioJsonRpc({
      command: capture.mcpServers[0].command,
      args: capture.mcpServers[0].args ?? [],
      cwd: tempProjectRoot,
      method: "tools/call",
      rpcParams: {
        name: "desktop_smoke_tool",
        arguments: { path: "README.md" },
      },
    });
    const brokerSnapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const brokerRoute = brokerSnapshot.mcp.agentRouting.routes.find(
      (route) => route.serverId === "desktop-session-injected-mcp"
    );
    console.log(
      "MCP_SESSION_BROKER",
      JSON.stringify({
        responseHasResult: Boolean(brokerCall.result),
        brokerMode: brokerRoute?.brokerMode ?? null,
        agentInvocationCount: brokerRoute?.agentInvocationCount ?? 0,
        last: brokerRoute?.lastAgentInvocation
          ? [
              brokerRoute.lastAgentInvocation.method,
              brokerRoute.lastAgentInvocation.status,
              brokerRoute.lastAgentInvocation.target,
            ]
          : null,
      })
    );
    if (
      !JSON.stringify(brokerCall).includes("desktop tool call desktop_smoke_tool") ||
      brokerRoute?.brokerMode !== "stdio-proxy" ||
      (brokerRoute.agentInvocationCount ?? 0) < 1 ||
      brokerRoute.lastAgentInvocation?.method !== "tools/call" ||
      brokerRoute.lastAgentInvocation?.status !== "success" ||
      brokerRoute.lastAgentInvocation?.target !== "desktop_smoke_tool"
    ) {
      throw new Error("Desktop smoke MCP broker did not execute and audit agent call.");
    }
  } finally {
    if (mcpChatId) {
      await request<unknown>(
        operation("mutation", "stopSession", { chatId: mcpChatId })
      ).catch(() => undefined);
    }
    if (tempAgent) {
      await request<unknown>(
        operation("mutation", "agents.delete", { id: tempAgent.id })
      ).catch(() => undefined);
    }
    await request<unknown>(
      operation("mutation", "setActiveProject", { id: repoProjectId })
    ).catch(() => undefined);
    if (tempProject) {
      await request<unknown>(
        operation("mutation", "deleteProject", { id: tempProject.id })
      ).catch(() => undefined);
    }
    await rm(tempProjectRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function subscribeUntilConnected(chatId: string): Promise<{
  subscriptionId: string | null;
  connected: boolean;
  assistantSeen: () => boolean;
}> {
  let subscriptionId: string | null = null;
  let assistantObserved = false;
  const connected = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    host
      .subscribeOperation({
        auth: { localAuthToken: token },
        operation: operation("subscription", "onSessionEvents", { chatId }),
        onEvent: (event) => {
          if (event.type === "started") {
            console.log("SUBSCRIPTION_STARTED");
          }
          if (event.type === "data") {
            const data = event.data as { type?: string } | undefined;
            if (data?.type === "connected") {
              clearTimeout(timer);
              resolve(true);
            }
            if (
              data?.type === "message" ||
              data?.type === "message_part" ||
              data?.type === "ui_message"
            ) {
              assistantObserved = true;
            }
          }
          if (event.type === "error") {
            console.log("SUBSCRIPTION_ERROR", JSON.stringify(event.error));
          }
        },
      })
      .then((result) => {
        subscriptionId = result.subscriptionId;
      })
      .catch((error) => {
        clearTimeout(timer);
        console.log(
          "SUBSCRIBE_FAILED",
          error instanceof Error ? error.message : String(error)
        );
        resolve(false);
      });
  });

  return {
    subscriptionId,
    connected,
    assistantSeen: () => assistantObserved,
  };
}

async function main(): Promise<void> {
  let chatId: string | null = null;
  let subscriptionId: string | null = null;
  let sessionLifecycleHooksBackup: string | null | undefined;
  const previousMcpAuth = process.env.ERAGEAR_DESKTOP_MCP_AUTH;
  const previousAllowedAgentPolicies = process.env.ALLOWED_AGENT_COMMAND_POLICIES;
  const smokeAgentPolicies: Array<{ command: string; allowAnyArgs: true }> = [
    { command: process.execPath, allowAnyArgs: true },
  ];
  for (const command of ["opencode", "codex", "claude", "gemini"]) {
    const resolved = await resolveCliCommand(command);
    if (resolved) {
      smokeAgentPolicies.push({ command: resolved, allowAnyArgs: true });
    }
  }
  process.env.ALLOWED_AGENT_COMMAND_POLICIES = JSON.stringify(smokeAgentPolicies);
  process.env.ERAGEAR_DESKTOP_MCP_AUTH = "Bearer desktop-mcp-secret";

  try {
    const diagnostics = await host.start();
    console.log(
      "START",
      JSON.stringify({
        endpoint: diagnostics.endpoint.kind,
        ready: diagnostics.health.ready,
        clis: diagnostics.cliAvailability.map((cli) => [
          cli.id,
          cli.available,
          cli.version ?? null,
        ]),
      })
    );

    const project = await ensureRepoProject();
    const ade = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    console.log(
      "ADE",
      JSON.stringify({
        projectRoot: ade.projectRoot,
        providers: ade.providers.map((provider) => [
          provider.id,
          provider.status,
          provider.cliStatus ?? null,
          provider.authStatus ?? null,
          provider.modelStatus ?? null,
          provider.version ?? null,
        ]),
        mcp: ade.mcp.servers.map((server) => [
          server.name,
          server.health,
          server.protocol.status,
          server.protocol.toolsDiscovered,
          server.protocol.resourcesDiscovered,
        ]),
        checkpoints: ade.checkpoints.items.length,
        projectIndex: [
          ade.projectIndex.indexedFiles,
          ade.projectIndex.indexedAt ?? null,
        ],
        hooks: ade.hooks.items.map((hook) => [
          hook.name,
          hook.event,
          hook.enabled,
        ]),
        plugins: ade.plugins.items.map((plugin) => [
          plugin.name,
          plugin.enabled,
        ]),
        commands: ade.capabilities.capabilities
          .filter((item) => item.kind === "command")
          .map((item) => item.name),
        subagents: ade.subagents.map((item) => [item.name, item.enabled]),
        memory: ade.projectMemory.sources.map((source) => source.relativePath),
        blockers: ade.blockers.map((blocker) => blocker.workflow),
      })
    );
    if (!ade.subagents.some((item) => item.name === "code-reviewer" && item.enabled)) {
      throw new Error("Expected enabled code-reviewer subagent in Local ADE snapshot.");
    }
    const subagentCommand = ade.capabilities.capabilities.find(
      (item) =>
        item.kind === "subagent" && item.name === "code-reviewer" && item.enabled
    );
    if (!subagentCommand) {
      throw new Error("Expected code-reviewer subagent command in Local ADE capabilities.");
    }
    console.log(
      "SUBAGENT_COMMAND_READY",
      JSON.stringify({
        command: "/agent-code-reviewer",
        name: subagentCommand.name,
        sourcePath: subagentCommand.sourcePath ?? null,
      })
    );

    const agent = await chooseAgent();

    await runCheckpointRiskSmoke(project.id, agent.id);
    await runMcpSessionInjectionSmoke(project.id);

    await withFileBackup(smokeCommandPath, async () => {
      await mkdir(path.dirname(smokeCommandPath), { recursive: true });
      await writeFile(
        smokeCommandPath,
        [
          "---",
          "name: /desktop-smoke",
          "description: Desktop smoke local command",
          "argument-hint: <smoke request>",
          "---",
          "Reply with exactly: desktop command smoke ok for $ARGUMENTS",
          "",
        ].join("\n"),
        "utf8"
      );
      const commandSnapshot = await request<LocalAdeSnapshot>(
        operation("query", "settings.getLocalAdeSnapshot")
      );
      const smokeCommand = commandSnapshot.commands.find(
        (command) => command.name === "/desktop-smoke" && command.enabled
      );
      console.log(
        "COMMAND_DISCOVERY",
        JSON.stringify({
          present: Boolean(smokeCommand),
          promptHasPlaceholder: smokeCommand?.prompt.includes("$ARGUMENTS") ?? false,
          argumentHint: smokeCommand?.argumentHint ?? null,
          capabilityPresent: commandSnapshot.capabilities.capabilities.some(
            (item) =>
              item.kind === "command" &&
              item.name === "/desktop-smoke" &&
              item.enabled
          ),
        })
      );
      if (
        !smokeCommand ||
        smokeCommand.argumentHint !== "<smoke request>" ||
        !smokeCommand.prompt.includes("$ARGUMENTS")
      ) {
        throw new Error("Desktop smoke local slash command discovery did not complete.");
      }
    });

    await withFileBackup(capabilitiesStatePath, async () => {
      await withFileBackup(smokeMemoryPath, async () => {
        await mkdir(path.dirname(smokeMemoryPath), { recursive: true });
        await writeFile(
          smokeMemoryPath,
          [
            "# Desktop smoke project context",
            "Prefer runtime-backed Local ADE actions.",
            "api_key=desktop-memory-secret",
            "",
          ].join("\n"),
          "utf8"
        );
        let memorySnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const memorySource = memorySnapshot.projectMemory.sources.find(
          (source) => source.relativePath === ".eragear/context.md"
        );
        if (!memorySource) {
          throw new Error("Desktop smoke project memory source was not discovered.");
        }
        if (!memorySource.enabled) {
          await request<LocalAdeSnapshot>(
            operation("mutation", "settings.updateCapabilityState", {
              capabilityId: memorySource.id,
              enabled: true,
            })
          );
        }
        const memoryContext = await request<ProjectMemoryContextResult>(
          operation("query", "settings.buildProjectMemoryContext", {
            query: "desktop smoke memory policy",
            sourcePaths: [memorySource.relativePath],
            maxBytes: 4000,
          })
        );
        console.log(
          "PROJECT_MEMORY_CONTEXT",
          JSON.stringify({
            status: memoryContext.status,
            sourceCount: memoryContext.sources.length,
            sources: memoryContext.sources.map((source) => [
              source.relativePath,
              source.includedBytes,
              source.truncated,
            ]),
            promptHasMemory: memoryContext.prompt.includes(
              "Prefer runtime-backed Local ADE actions."
            ),
            promptRedacted:
              memoryContext.prompt.includes("api_key= [redacted]") &&
              !memoryContext.prompt.includes("desktop-memory-secret"),
          })
        );
        if (
          memoryContext.status !== "ready" ||
          memoryContext.sources.length <= 0 ||
          !memoryContext.prompt.includes("Prefer runtime-backed Local ADE actions.") ||
          !memoryContext.prompt.includes("api_key= [redacted]") ||
          memoryContext.prompt.includes("desktop-memory-secret")
        ) {
          throw new Error("Desktop smoke project memory context did not complete.");
        }
      });
    });

    await withFileBackup(smokeSkillPath, async () => {
      await withFileBackup(smokeOutputStylePath, async () => {
        await mkdir(path.dirname(smokeSkillPath), { recursive: true });
        await mkdir(path.dirname(smokeOutputStylePath), { recursive: true });
        await writeFile(
          smokeSkillPath,
          [
            "---",
            "name: Desktop Smoke Skill",
            "description: Verify skill invocation descriptors",
            "---",
            "Use the desktop smoke skill instructions.",
            "",
          ].join("\n"),
          "utf8"
        );
        await writeFile(
          smokeOutputStylePath,
          [
            "---",
            "name: Desktop Smoke Style",
            "description: Verify output style descriptors",
            "---",
            "Answer in the desktop smoke output style.",
            "",
          ].join("\n"),
          "utf8"
        );
        const instructionSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const smokeSkill = instructionSnapshot.skills.find(
          (skill) => skill.name === "Desktop Smoke Skill" && skill.enabled
        );
        const smokeStyle = instructionSnapshot.outputStyles.find(
          (style) => style.name === "Desktop Smoke Style" && style.enabled
        );
        console.log(
          "INSTRUCTION_DISCOVERY",
          JSON.stringify({
            skillPresent: Boolean(smokeSkill),
            skillPrompt: smokeSkill?.prompt.includes("desktop smoke skill") ?? false,
            stylePresent: Boolean(smokeStyle),
            stylePrompt:
              smokeStyle?.prompt.includes("desktop smoke output style") ?? false,
            skillCapability: instructionSnapshot.capabilities.capabilities.some(
              (item) =>
                item.kind === "skill" &&
                item.name === "Desktop Smoke Skill" &&
                item.enabled
            ),
            styleCapability: instructionSnapshot.capabilities.capabilities.some(
              (item) =>
                item.kind === "output-style" &&
                item.name === "Desktop Smoke Style" &&
                item.enabled
            ),
          })
        );
        if (
          !smokeSkill ||
          !smokeSkill.prompt.includes("desktop smoke skill") ||
          !smokeStyle ||
          !smokeStyle.prompt.includes("desktop smoke output style")
        ) {
          throw new Error(
            "Desktop smoke local skill/output-style discovery did not complete."
          );
        }
      });
    });

    await withFileBackup(repoIndexPath, async () => {
      const indexSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.refreshProjectIndex", {})
      );
      const persisted = JSON.parse(await readFile(repoIndexPath, "utf8")) as {
        files?: Array<{ path?: string }>;
        symbols?: Array<{ name?: string }>;
        tasks?: Array<{ marker?: string }>;
      };
      const hasGoal =
        persisted.files?.some((file) => file.path === "GOAL.md") ?? false;
      const hasSymbols = (persisted.symbols?.length ?? 0) > 0;
      const hasTasks = (persisted.tasks?.length ?? 0) > 0;
      console.log(
        "PROJECT_INDEX",
        JSON.stringify({
          indexedFiles: indexSnapshot.projectIndex.indexedFiles,
          totalBytes: indexSnapshot.projectIndex.totalBytes,
          extensions: indexSnapshot.projectIndex.extensions.slice(0, 5),
          symbolCount: indexSnapshot.projectIndex.symbols.length,
          taskCount: indexSnapshot.projectIndex.tasks.length,
          symbolSample: indexSnapshot.projectIndex.symbols
            .slice(0, 3)
            .map((symbol) => `${symbol.kind}:${symbol.name}`),
          taskSample: indexSnapshot.projectIndex.tasks
            .slice(0, 3)
            .map((task) => `${task.marker}:${task.path}:${task.line}`),
          visibleSample: indexSnapshot.projectIndex.files
            .slice(0, 5)
            .map((file) => file.path),
          persistedHasGoal: hasGoal,
          persistedHasSymbols: hasSymbols,
          persistedHasTasks: hasTasks,
        })
      );
      if (
        indexSnapshot.projectIndex.indexedFiles <= 0 ||
        indexSnapshot.projectIndex.symbols.length <= 0 ||
        indexSnapshot.projectIndex.tasks.length <= 0 ||
        !hasGoal ||
        !hasSymbols ||
        !hasTasks
      ) {
        throw new Error("Desktop smoke project index refresh did not complete.");
      }
      const searchQuery =
        indexSnapshot.projectIndex.tasks[0]?.marker ??
        indexSnapshot.projectIndex.symbols[0]?.name ??
        "GOAL.md";
      const indexSearch = await request<ProjectIndexSearchResult>(
        operation("query", "settings.searchProjectIndex", {
          query: searchQuery,
          limit: 6,
        })
      );
      console.log(
        "PROJECT_INDEX_SEARCH",
        JSON.stringify({
          status: indexSearch.status,
          query: indexSearch.query,
          resultCount: indexSearch.results.length,
          sample: indexSearch.results.slice(0, 3).map((item) => [
            item.type,
            item.title,
            item.path,
          ]),
          promptHasContext:
            indexSearch.prompt.includes("Matched project index entries") &&
            indexSearch.prompt.includes("Before editing, read the referenced files directly."),
        })
      );
      if (
        indexSearch.status !== "ready" ||
        indexSearch.results.length <= 0 ||
        !indexSearch.prompt.includes("Matched project index entries") ||
        !indexSearch.prompt.includes(
          "Before editing, read the referenced files directly."
        )
      ) {
        throw new Error("Desktop smoke project index search did not complete.");
      }
    });

    await withFileBackup(hooksPath, async () => {
      const hookSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-hook",
          name: "Desktop Smoke Hook",
          event: "manual",
          enabled: true,
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('desktop hook ok '+process.env.ERAGEAR_HOOK_EVENT)",
          ],
          timeoutMs: 5000,
        })
      );
      await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertHook", {
          id: "desktop-smoke-index-hook",
          name: "Desktop Smoke Index Hook",
          event: "after-project-index-refresh",
          enabled: true,
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('desktop lifecycle '+process.env.ERAGEAR_HOOK_EVENT)",
          ],
          timeoutMs: 5000,
        })
      );
      const smokeHookBeforeTrust = hookSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const untrustedHookCapability = hookSnapshot.capabilities.capabilities.find(
        (item) =>
          item.kind === "hook" &&
          item.name === "Desktop Smoke Hook"
      );
      let untrustedRunBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runHook", {
            hookId: "desktop-smoke-hook",
          })
        );
      } catch {
        untrustedRunBlocked = true;
      }
      const hookTrustSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-hook",
          fingerprint: smokeHookBeforeTrust?.fingerprint ?? "",
        })
      );
      const lifecycleBeforeTrust = hookTrustSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-index-hook"
      );
      const trustedSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustHook", {
          hookId: "desktop-smoke-index-hook",
          fingerprint: lifecycleBeforeTrust?.fingerprint ?? "",
        })
      );
      const trustedHook = trustedSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      const hookCapability = trustedSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "hook" &&
          item.name === "Desktop Smoke Hook" &&
          item.enabled
      );
      console.log(
        "HOOK_TRUST",
        JSON.stringify({
          beforeCapabilityEnabled: untrustedHookCapability?.enabled ?? null,
          beforeTrustStatus: smokeHookBeforeTrust?.trustStatus ?? "missing",
          trustStatus: trustedHook?.trustStatus ?? "missing",
          trusted: trustedHook?.trustedFingerprint === trustedHook?.fingerprint,
          untrustedRunBlocked,
          capabilityEnabled: hookCapability,
        })
      );
      if (
        untrustedHookCapability?.enabled !== false ||
        smokeHookBeforeTrust?.trustStatus !== "untrusted" ||
        !untrustedRunBlocked ||
        trustedHook?.trustStatus !== "trusted" ||
        !hookCapability
      ) {
        throw new Error("Desktop smoke hook trust gate did not complete.");
      }
      const runSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runHook", {
          hookId: "desktop-smoke-hook",
        })
      );
      const smokeHook = runSnapshot.hooks.items.find(
        (hook) => hook.id === "desktop-smoke-hook"
      );
      console.log(
        "HOOK_RUN",
        JSON.stringify({
          capabilityPresent: hookCapability,
          present: Boolean(smokeHook),
          status: smokeHook?.lastRun?.status ?? "missing",
          stdout: smokeHook?.lastRun?.stdout ?? "",
        })
      );
      if (
        !hookCapability ||
        smokeHook?.lastRun?.status !== "success" ||
        !smokeHook.lastRun.stdout.includes("desktop hook ok manual")
      ) {
        throw new Error("Desktop smoke hook execution did not complete.");
      }
      await withFileBackup(repoIndexPath, async () => {
        const lifecycleSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.refreshProjectIndex", {})
        );
        const lifecycleHook = lifecycleSnapshot.hooks.items.find(
          (hook) => hook.id === "desktop-smoke-index-hook"
        );
        console.log(
          "HOOK_LIFECYCLE",
          JSON.stringify({
            present: Boolean(lifecycleHook),
            status: lifecycleHook?.lastRun?.status ?? "missing",
            stdout: lifecycleHook?.lastRun?.stdout ?? "",
          })
        );
        if (
          lifecycleHook?.lastRun?.status !== "success" ||
          !lifecycleHook.lastRun.stdout.includes(
            "desktop lifecycle after-project-index-refresh"
          )
        ) {
          throw new Error("Desktop smoke lifecycle hook execution did not complete.");
        }
      });
    });

    const previousPluginAllowed = process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED;
    const previousPlugin_BLOCKED = process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED;
    process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED = "allowed-plugin-secret";
    process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED = "blocked-plugin-secret";
    try {
    await withFileBackup(pluginsPath, async () => {
      const pluginSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.upsertPlugin", {
          id: "desktop-smoke-plugin",
          name: "Desktop Smoke Plugin",
          description: "Desktop smoke executable plugin",
          enabled: true,
          scopes: ["process", "project-root", "env"],
          envKeys: ["ERAGEAR_DESKTOP_PLUGIN_ALLOWED"],
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write(['desktop plugin ok '+process.env.ERAGEAR_PLUGIN_NAME,'allowed_secret='+process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED,'blocked='+Boolean(process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED),'scopes='+process.env.ERAGEAR_PLUGIN_SCOPES].join('\\n'))",
          ],
          timeoutMs: 5000,
        })
      );
      const pluginCapability = pluginSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "plugin" &&
          item.name === "Desktop Smoke Plugin" &&
          item.enabled
      );
      const savedPlugin = pluginSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      let untrustedRunBlocked = false;
      try {
        await request<LocalAdeSnapshot>(
          operation("mutation", "settings.runPlugin", {
            pluginId: "desktop-smoke-plugin",
          })
        );
      } catch (error) {
        untrustedRunBlocked = error instanceof Error
          ? error.message.includes("trusted")
          : String(error).includes("trusted");
      }
      if (!savedPlugin?.fingerprint || !untrustedRunBlocked) {
        throw new Error("Desktop smoke plugin trust gate did not block execution.");
      }
      const trustSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.trustPlugin", {
          pluginId: "desktop-smoke-plugin",
          fingerprint: savedPlugin.fingerprint,
        })
      );
      const trustedPlugin = trustSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      const trustedCapability = trustSnapshot.capabilities.capabilities.some(
        (item) =>
          item.kind === "plugin" &&
          item.name === "Desktop Smoke Plugin" &&
          item.enabled
      );
      console.log(
        "PLUGIN_TRUST",
        JSON.stringify({
          present: Boolean(trustedPlugin),
          beforeCapabilityEnabled: pluginCapability,
          trustStatus: trustedPlugin?.trustStatus ?? "missing",
          trusted: trustedPlugin?.trustedFingerprint === trustedPlugin?.fingerprint,
          scopes: trustedPlugin?.scopes ?? [],
          envKeys: trustedPlugin?.envKeys ?? [],
          untrustedRunBlocked,
          capabilityEnabled: trustedCapability,
        })
      );
      const runSnapshot = await request<LocalAdeSnapshot>(
        operation("mutation", "settings.runPlugin", {
          pluginId: "desktop-smoke-plugin",
        })
      );
      const smokePlugin = runSnapshot.plugins.items.find(
        (plugin) => plugin.id === "desktop-smoke-plugin"
      );
      console.log(
        "PLUGIN_RUN",
        JSON.stringify({
          capabilityPresent: trustedCapability,
          present: Boolean(smokePlugin),
          status: smokePlugin?.lastRun?.status ?? "missing",
          stdout: smokePlugin?.lastRun?.stdout ?? "",
        })
      );
      if (
        pluginCapability ||
        !trustedCapability ||
        trustedPlugin?.trustStatus !== "trusted" ||
        !trustedPlugin?.scopes.includes("env") ||
        trustedPlugin?.envKeys[0] !== "ERAGEAR_DESKTOP_PLUGIN_ALLOWED" ||
        smokePlugin?.lastRun?.status !== "success" ||
        !smokePlugin.lastRun.stdout.includes(
          "desktop plugin ok Desktop Smoke Plugin"
        ) ||
        !smokePlugin.lastRun.stdout.includes("allowed_secret= [redacted]") ||
        !smokePlugin.lastRun.stdout.includes("blocked=false")
      ) {
        throw new Error("Desktop smoke plugin execution did not complete.");
      }
    });
    } finally {
      if (previousPluginAllowed === undefined) {
        delete process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED;
      } else {
        process.env.ERAGEAR_DESKTOP_PLUGIN_ALLOWED = previousPluginAllowed;
      }
      if (previousPlugin_BLOCKED === undefined) {
        delete process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED;
      } else {
        process.env.ERAGEAR_DESKTOP_PLUGIN_BLOCKED = previousPlugin_BLOCKED;
      }
    }

    await withFileBackup(ade.mcp.configPath, async () => {
      const sseMcp = await startSseMcpFixture({
        closeFirstStreamOnFirstRequest: true,
        closeOnceOnMethod: "resources/read",
      });
      try {
        const mcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertMcpServer", {
            id: "desktop-smoke-mcp",
            name: "Desktop Smoke MCP",
            transport: "stdio",
            enabled: true,
            command: process.execPath,
            args: [smokeMcpScript],
          })
        );
        let smokeMcp = mcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        const probedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.probeMcpServer", {
            id: "desktop-smoke-mcp",
          })
        );
        smokeMcp = probedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_DISCOVERY",
          JSON.stringify({
            health: smokeMcp?.health ?? "missing",
            protocol: smokeMcp?.protocol.status ?? "missing",
            probe: smokeMcp?.probe
              ? {
                  status: smokeMcp.probe.status,
                  steps: smokeMcp.probe.steps.map((step) => [
                    step.step,
                    step.status,
                  ]),
                  history: smokeMcp.probeHistory.map((run) => [
                    run.status,
                    run.protocolStatus,
                    run.stepCount,
                  ]),
                }
              : "missing",
            tools: smokeMcp?.tools.map((tool) => tool.name) ?? [],
            resources:
              smokeMcp?.resources.map((resource) => resource.name ?? resource.uri) ?? [],
          })
        );
        if (
          smokeMcp?.health !== "available" ||
          smokeMcp.protocol.status !== "initialized" ||
          smokeMcp.probe.status !== "success" ||
          smokeMcp.probeHistory[0]?.status !== "success" ||
          smokeMcp.probeHistory[0]?.protocolStatus !== "initialized" ||
          !smokeMcp.probe.steps.some((step) => step.step === "initialize") ||
          !smokeMcp.tools.some((tool) => tool.name === "desktop_smoke_tool")
        ) {
          throw new Error("Desktop smoke MCP protocol discovery did not complete.");
        }
        if (smokeMcp.trustStatus !== "untrusted") {
          throw new Error("Desktop smoke MCP should require invocation trust first.");
        }
        const blockedStdioToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-mcp",
            toolName: "desktop_smoke_tool",
            arguments: { path: "README.md" },
          })
        );
        console.log(
          "MCP_INVOKE_POLICY",
          JSON.stringify({
            status: blockedStdioToolResult.status,
            diagnostics: blockedStdioToolResult.diagnostics,
          })
        );
        if (
          blockedStdioToolResult.status !== "failed" ||
          !blockedStdioToolResult.diagnostics
            .join("\n")
            .includes("MCP invocation blocked by trust policy")
        ) {
          throw new Error("Desktop smoke MCP trust policy did not block invocation.");
        }
        const trustedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustMcpServer", {
            serverId: "desktop-smoke-mcp",
            fingerprint: smokeMcp.fingerprint,
          })
        );
        smokeMcp = trustedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_TRUST",
          JSON.stringify({
            trustStatus: smokeMcp?.trustStatus ?? "missing",
            trusted: smokeMcp?.trustedFingerprint === smokeMcp?.fingerprint,
          })
        );
        if (
          smokeMcp?.trustStatus !== "trusted" ||
          smokeMcp.trustedFingerprint !== smokeMcp.fingerprint
        ) {
          throw new Error("Desktop smoke MCP trust approval did not persist.");
        }
        const stdioToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-mcp",
            toolName: "desktop_smoke_tool",
            arguments: { path: "README.md" },
          })
        );
        const stdioResourceResult = await request<McpInvocationResult>(
          operation("mutation", "settings.readMcpResource", {
            serverId: "desktop-smoke-mcp",
            uri: "file:///desktop-smoke",
          })
        );
        console.log(
          "MCP_INVOKE",
          JSON.stringify({
            toolStatus: stdioToolResult.status,
            toolText: stdioToolResult.resultText,
            resourceStatus: stdioResourceResult.status,
            resourceText: stdioResourceResult.resultText,
          })
        );
        if (
          stdioToolResult.status !== "success" ||
          !stdioToolResult.resultText.includes("desktop tool call desktop_smoke_tool") ||
          stdioResourceResult.status !== "success" ||
          !stdioResourceResult.resultText.includes(
            "desktop resource read file:///desktop-smoke"
          )
        ) {
          throw new Error("Desktop smoke MCP invocation did not complete.");
        }
        const invokedMcpSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const invokedMcp = invokedMcpSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke MCP"
        );
        console.log(
          "MCP_INVOKE_AUDIT",
          JSON.stringify({
            count: invokedMcp?.invocationHistory.length ?? 0,
            methods:
              invokedMcp?.invocationHistory.map((run) => [
                run.method,
                run.status,
                run.target,
              ]) ?? [],
          })
        );
        if (
          !invokedMcp ||
          invokedMcp.invocationHistory.length < 3 ||
          invokedMcp.invocationHistory[0]?.method !== "resources/read" ||
          invokedMcp.invocationHistory[1]?.method !== "tools/call" ||
          invokedMcp.invocationHistory[2]?.status !== "failed"
        ) {
          throw new Error("Desktop smoke MCP invocation audit was not persisted.");
        }
        console.log(
          "MCP_NOTIFICATIONS",
          JSON.stringify({
            count: invokedMcp.notificationHistory.length,
            notifications: invokedMcp.notificationHistory.map((notification) => [
              notification.source,
              notification.method,
              notification.payloadText,
            ]),
          })
        );
        if (
          !invokedMcp.notificationHistory.some(
            (notification) =>
              notification.source === "probe" &&
              notification.method === "notifications/message"
          ) ||
          !invokedMcp.notificationHistory.some(
            (notification) =>
              notification.source === "invocation" &&
              notification.method === "notifications/progress"
          )
        ) {
          throw new Error("Desktop smoke MCP notification history was not captured.");
        }
        const sseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.upsertMcpServer", {
            id: "desktop-smoke-sse-mcp",
            name: "Desktop Smoke SSE MCP",
            transport: "sse",
            enabled: true,
            url: sseMcp.streamUrl,
            messageEndpoint: sseMcp.messageEndpoint,
            headerEnv: { Authorization: "ERAGEAR_DESKTOP_MCP_AUTH" },
          })
        );
        let smokeSseMcp = sseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        const sseReconnectVerified = Boolean(
          smokeSseMcp?.probe.steps.some(
            (step) => step.step === "stream-reconnect"
          ) && (sseMcp.requestCounts.initialize ?? 0) >= 2
        );
        const probedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.probeMcpServer", {
            id: "desktop-smoke-sse-mcp",
          })
        );
        smokeSseMcp = probedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_DISCOVERY",
          JSON.stringify({
            health: smokeSseMcp?.health ?? "missing",
            protocol: smokeSseMcp?.protocol.status ?? "missing",
            probe: smokeSseMcp?.probe
              ? {
                  status: smokeSseMcp.probe.status,
                  steps: smokeSseMcp.probe.steps.map((step) => [
                    step.step,
                    step.status,
                  ]),
                  history: smokeSseMcp.probeHistory.map((run) => [
                    run.status,
                    run.protocolStatus,
                    run.stepCount,
                  ]),
                }
              : "missing",
            headerEnv: smokeSseMcp?.headerEnv ?? [],
            reconnect: {
              verified: sseReconnectVerified,
              initializeRequests: sseMcp.requestCounts.initialize ?? 0,
            },
            tools: smokeSseMcp?.tools.map((tool) => tool.name) ?? [],
            resources:
              smokeSseMcp?.resources.map(
                (resource) => resource.name ?? resource.uri
              ) ?? [],
          })
        );
        if (
          smokeSseMcp?.health !== "available" ||
          smokeSseMcp.protocol.status !== "initialized" ||
          smokeSseMcp.probe.status !== "success" ||
          smokeSseMcp.probeHistory[0]?.status !== "success" ||
          smokeSseMcp.probeHistory[0]?.protocolStatus !== "initialized" ||
          !smokeSseMcp.probe.steps.some((step) => step.step === "stream-open") ||
          !smokeSseMcp.probe.steps.some((step) => step.step === "endpoint") ||
          !sseReconnectVerified ||
          smokeSseMcp.headerEnv[0]?.header !== "Authorization" ||
          smokeSseMcp.headerEnv[0]?.envKey !== "ERAGEAR_DESKTOP_MCP_AUTH" ||
          smokeSseMcp.headerEnv[0]?.present !== true ||
          !smokeSseMcp.tools.some(
            (tool) => tool.name === "desktop_smoke_sse_tool"
          )
        ) {
          throw new Error("Desktop smoke SSE MCP discovery did not complete.");
        }
        if (smokeSseMcp.trustStatus !== "untrusted") {
          throw new Error("Desktop smoke SSE MCP should require invocation trust first.");
        }
        const trustedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("mutation", "settings.trustMcpServer", {
            serverId: "desktop-smoke-sse-mcp",
            fingerprint: smokeSseMcp.fingerprint,
          })
        );
        smokeSseMcp = trustedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_TRUST",
          JSON.stringify({
            trustStatus: smokeSseMcp?.trustStatus ?? "missing",
            trusted: smokeSseMcp?.trustedFingerprint === smokeSseMcp?.fingerprint,
          })
        );
        if (
          smokeSseMcp?.trustStatus !== "trusted" ||
          smokeSseMcp.trustedFingerprint !== smokeSseMcp.fingerprint
        ) {
          throw new Error("Desktop smoke SSE MCP trust approval did not persist.");
        }
        const agentRouting = trustedSseSnapshot.mcp.agentRouting;
        console.log(
          "MCP_AGENT_ROUTING",
          JSON.stringify({
            status: agentRouting.status,
            direct: agentRouting.injectableCount,
            conditional: agentRouting.conditionalCount,
            blocked: agentRouting.blockedCount,
            routes: agentRouting.routes.map((route) => [
              route.serverName,
              route.status,
              route.transport,
              route.brokerMode,
              route.requiresAgentCapability ?? "none",
              route.agentSupport,
              route.agentInvocationCount,
            ]),
          })
        );
        const stdioRoute = agentRouting.routes.find(
          (route) => route.serverName === "Desktop Smoke MCP"
        );
        const sseRoute = agentRouting.routes.find(
          (route) => route.serverName === "Desktop Smoke SSE MCP"
        );
        if (
          agentRouting.injectableCount < 1 ||
          agentRouting.conditionalCount < 1 ||
          stdioRoute?.status !== "injectable" ||
          stdioRoute.brokerMode !== "stdio-proxy" ||
          stdioRoute.agentSupport !== "not-required" ||
          sseRoute?.status !== "conditional" ||
          sseRoute.brokerMode !== "native-agent-transport" ||
          sseRoute.requiresAgentCapability !== "sse" ||
          sseRoute.agentSupport !== "required-at-session-start" ||
          JSON.stringify(agentRouting).includes("Bearer desktop-mcp-secret")
        ) {
          throw new Error("Desktop smoke MCP agent routing preview was not correct.");
        }
        const sseToolResult = await request<McpInvocationResult>(
          operation("mutation", "settings.invokeMcpTool", {
            serverId: "desktop-smoke-sse-mcp",
            toolName: "desktop_smoke_sse_tool",
            arguments: { path: "SSE.md" },
          })
        );
        const sseResourceResult = await request<McpInvocationResult>(
          operation("mutation", "settings.readMcpResource", {
            serverId: "desktop-smoke-sse-mcp",
            uri: "memory://desktop-smoke-sse",
          })
        );
        console.log(
          "MCP_SSE_INVOKE",
          JSON.stringify({
            toolStatus: sseToolResult.status,
            toolText: sseToolResult.resultText,
            resourceStatus: sseResourceResult.status,
            resourceText: sseResourceResult.resultText,
            diagnostics: sseToolResult.diagnostics,
          })
        );
        console.log(
          "MCP_SSE_RESOURCE_RECONNECT",
          JSON.stringify({
            status: sseResourceResult.status,
            requests: sseMcp.requestCounts["resources/read"] ?? 0,
            diagnostics: sseResourceResult.diagnostics,
          })
        );
        if (
          sseToolResult.status !== "success" ||
          !sseToolResult.resultText.includes(
            "desktop sse tool desktop_smoke_sse_tool"
          ) ||
          !sseToolResult.resultText.includes("[redacted]") ||
          sseToolResult.resultText.includes("Bearer desktop-mcp-secret") ||
          sseResourceResult.status !== "success" ||
          !sseResourceResult.resultText.includes(
            "desktop sse resource memory://desktop-smoke-sse"
          ) ||
          (sseMcp.requestCounts["resources/read"] ?? 0) < 2 ||
          !sseResourceResult.diagnostics
            .join("\n")
            .includes("MCP SSE invocation stream closed before completion; reconnecting")
        ) {
          throw new Error("Desktop smoke SSE MCP invocation/redaction did not complete.");
        }
        const invokedSseSnapshot = await request<LocalAdeSnapshot>(
          operation("query", "settings.getLocalAdeSnapshot")
        );
        const invokedSseMcp = invokedSseSnapshot.mcp.servers.find(
          (server) => server.name === "Desktop Smoke SSE MCP"
        );
        console.log(
          "MCP_SSE_INVOKE_AUDIT",
          JSON.stringify({
            count: invokedSseMcp?.invocationHistory.length ?? 0,
            methods:
              invokedSseMcp?.invocationHistory.map((run) => [
                run.method,
                run.status,
                run.target,
                run.resultText,
              ]) ?? [],
          })
        );
        const serializedSseInvocationHistory = JSON.stringify(
          invokedSseMcp?.invocationHistory ?? []
        );
        if (
          !invokedSseMcp ||
          !invokedSseMcp.invocationHistory.some(
            (run) =>
              run.method === "tools/call" &&
              run.status === "success" &&
              run.resultText.includes("[redacted]")
          ) ||
          !invokedSseMcp.invocationHistory.some(
            (run) =>
              run.method === "resources/read" &&
              run.status === "success" &&
              run.resultText.includes("desktop sse resource")
          ) ||
          serializedSseInvocationHistory.includes(
            "Bearer desktop-mcp-secret"
          )
        ) {
          throw new Error("Desktop smoke SSE MCP invocation audit/redaction failed.");
        }
        console.log(
          "MCP_SSE_NOTIFICATIONS",
          JSON.stringify({
            count: invokedSseMcp.notificationHistory.length,
            notifications: invokedSseMcp.notificationHistory.map((notification) => [
              notification.source,
              notification.method,
              notification.payloadText,
            ]),
          })
        );
        const serializedSseNotifications = JSON.stringify(
          invokedSseMcp.notificationHistory
        );
        if (
          !invokedSseMcp.notificationHistory.some(
            (notification) =>
              notification.source === "probe" &&
              notification.method === "notifications/message"
          ) ||
          !invokedSseMcp.notificationHistory.some(
            (notification) =>
              notification.source === "invocation" &&
              notification.method === "notifications/message"
          ) ||
          !serializedSseNotifications.includes("[redacted]") ||
          serializedSseNotifications.includes("Bearer desktop-mcp-secret")
        ) {
          throw new Error(
            "Desktop smoke SSE MCP notification history/redaction failed."
          );
        }
      } finally {
        await sseMcp.close();
      }
    });

    const providerSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.testProvider", {
        providerId: `provider.agent.${agent.id}`,
      })
    );
    const testedProvider = providerSnapshot.providers.find(
      (provider) => provider.id === `provider.agent.${agent.id}`
    );
    console.log(
      "AGENT",
      JSON.stringify({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        command: agent.command,
        args: agent.args ?? [],
        providerStatus: testedProvider?.status ?? "missing",
        providerCliStatus: testedProvider?.cliStatus ?? "missing",
        providerAuthStatus: testedProvider?.authStatus ?? "missing",
        providerModelStatus: testedProvider?.modelStatus ?? "missing",
        providerVersion: testedProvider?.version ?? null,
      })
    );
    if (testedProvider?.cliStatus !== "ok") {
      throw new Error(
        `Expected provider CLI readiness to be ok, got ${testedProvider?.cliStatus ?? "missing"}.`
      );
    }
    await testCodexProviderDoctor();

    sessionLifecycleHooksBackup = await readOptionalFile(hooksPath);
    const agentLifecycleHookScript =
      "process.stdout.write(['desktop agent lifecycle',process.env.ERAGEAR_HOOK_EVENT,process.env.ERAGEAR_CHAT_ID||'',process.env.ERAGEAR_TURN_ID||''].join(' '))";
    const createHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-create-hook",
        name: "Desktop Smoke Agent Create Hook",
        event: "after-agent-session-create",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const messageHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-message-hook",
        name: "Desktop Smoke Agent Message Hook",
        event: "after-agent-message-send",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const stopHookSnapshot = await request<LocalAdeSnapshot>(
      operation("mutation", "settings.upsertHook", {
        id: "desktop-smoke-agent-stop-hook",
        name: "Desktop Smoke Agent Stop Hook",
        event: "after-agent-session-stop",
        enabled: true,
        command: process.execPath,
        args: ["-e", agentLifecycleHookScript],
        timeoutMs: 5000,
      })
    );
    const agentCreateHook = createHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-create-hook"
    );
    const agentMessageHook = messageHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-message-hook"
    );
    const agentStopHook = stopHookSnapshot.hooks.items.find(
      (hook) => hook.id === "desktop-smoke-agent-stop-hook"
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-create-hook",
        fingerprint: agentCreateHook?.fingerprint ?? "",
      })
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-message-hook",
        fingerprint: agentMessageHook?.fingerprint ?? "",
      })
    );
    await request<LocalAdeSnapshot>(
      operation("mutation", "settings.trustHook", {
        hookId: "desktop-smoke-agent-stop-hook",
        fingerprint: agentStopHook?.fingerprint ?? "",
      })
    );

    const created = await request<SessionCreateResult>(
      operation("mutation", "createSession", {
        projectId: project.id,
        agentId: agent.id,
      })
    );
    chatId = created.chatId;
    console.log(
      "SESSION_CREATED",
      JSON.stringify({
        chatId,
        sessionId: created.sessionId ?? null,
        status: created.chatStatus,
      })
    );
    const createLifecycleRun = await waitForHookRun(
      "desktop-smoke-agent-create-hook",
      "desktop agent lifecycle after-agent-session-create"
    );
    console.log(
      "HOOK_AGENT_LIFECYCLE_CREATE",
      JSON.stringify({
        status: createLifecycleRun.status,
        stdout: createLifecycleRun.stdout,
      })
    );

    const subscription = await subscribeUntilConnected(chatId);
    subscriptionId = subscription.subscriptionId;
    const state = await request<SessionStateResult>(
      operation("query", "getSessionState", { chatId })
    );
    console.log(
      "SESSION_STATE",
      JSON.stringify({
        status: state.status,
        chatStatus: state.chatStatus,
        connected: subscription.connected,
        agent: state.agentInfo?.title ?? state.agentInfo?.name ?? null,
      })
    );

    const subagentCommandText =
      "/agent-code-reviewer Reply with exactly: desktop IPC smoke ok";
    const subagentSubmission = resolveSmokeSubagentCommand({
      text: subagentCommandText,
      subagents: ade.subagents,
    });
    if (!subagentSubmission) {
      throw new Error("Expected /agent-code-reviewer to resolve for desktop smoke.");
    }
    console.log(
      "SUBAGENT_COMMAND_SUBMIT",
      JSON.stringify({
        command: subagentSubmission.command,
        sourcePath: subagentSubmission.sourcePath,
        promptIncludesDelegate: subagentSubmission.prompt.includes(
          'Delegate this task to the "code-reviewer" subagent profile.'
        ),
        promptIncludesRequest:
          subagentSubmission.prompt.includes("desktop IPC smoke ok"),
      })
    );

    const sent = await request<unknown>(
      operation("mutation", "sendMessage", {
        chatId,
        text: subagentSubmission.prompt,
      })
    );
    console.log("MESSAGE_SENT", JSON.stringify(sent));
    const messageLifecycleRun = await waitForHookRun(
      "desktop-smoke-agent-message-hook",
      "desktop agent lifecycle after-agent-message-send"
    );
    console.log(
      "HOOK_AGENT_LIFECYCLE_MESSAGE",
      JSON.stringify({
        status: messageLifecycleRun.status,
        stdout: messageLifecycleRun.stdout,
      })
    );
    await wait(promptWaitMs);
    console.log(
      "MESSAGE_OBSERVED",
      JSON.stringify({ assistantSeen: subscription.assistantSeen() })
    );
    const acpSnapshot = await request<LocalAdeSnapshot>(
      operation("query", "settings.getLocalAdeSnapshot")
    );
    const ownedAcpEntries = acpSnapshot.acpActivity.entries.filter(
      (entry) => entry.chatId === chatId
    );
    console.log(
      "ACP_ACTIVITY",
      JSON.stringify({
        total: acpSnapshot.acpActivity.stats.total,
        chatCount: acpSnapshot.acpActivity.stats.chatCount,
        owned: ownedAcpEntries.length,
        correlations: acpSnapshot.acpActivity.correlations.length,
        kinds: acpSnapshot.acpActivity.stats.kinds,
        sample: ownedAcpEntries.slice(0, 3).map((entry) => ({
          message: entry.message,
          kind: entry.kind ?? null,
          payloadBytes: entry.payloadBytes ?? null,
          metadata: entry.metadata,
        })),
      })
    );
    if (ownedAcpEntries.length === 0) {
      throw new Error("Expected Local ADE ACP activity for the active smoke chat.");
    }
    if (JSON.stringify(ownedAcpEntries).includes("rawPayload")) {
      throw new Error("ACP activity leaked rawPayload metadata.");
    }
    const acpTrace = await request<AcpActivityExportResult>(
      operation("mutation", "settings.exportAcpActivity", {
        chatId,
        limit: 20,
      })
    );
    console.log(
      "ACP_EXPORT",
      JSON.stringify({
        schemaVersion: acpTrace.schemaVersion,
        redacted: acpTrace.redacted,
        chatId: acpTrace.filters.chatId,
        limit: acpTrace.filters.limit,
        entries: acpTrace.entries.length,
        correlations: acpTrace.correlations.length,
        total: acpTrace.stats.total,
        sample: acpTrace.entries.slice(0, 2).map((entry) => ({
          message: entry.message,
          kind: entry.kind ?? null,
          payloadBytes: entry.payloadBytes ?? null,
          metadata: entry.metadata,
        })),
      })
    );
    if (acpTrace.schemaVersion !== 1 || acpTrace.redacted !== true) {
      throw new Error("ACP trace export did not declare its redacted schema.");
    }
    if (acpTrace.filters.chatId !== chatId) {
      throw new Error("ACP trace export did not preserve the active chat filter.");
    }
    if (acpTrace.entries.length === 0) {
      throw new Error("Expected exported ACP trace entries for the active chat.");
    }
    if (
      !acpTrace.correlations.some((correlation) => correlation.chatId === chatId)
    ) {
      throw new Error("Expected exported ACP trace correlation for the active chat.");
    }
    if (JSON.stringify(acpTrace).includes("rawPayload")) {
      throw new Error("ACP trace export leaked rawPayload metadata.");
    }
    const acpReplay = await request<AcpActivityReplayResult>(
      operation("mutation", "settings.replayAcpActivity", {
        chatId,
        limit: 20,
      })
    );
    console.log(
      "ACP_REPLAY",
      JSON.stringify({
        schemaVersion: acpReplay.schemaVersion,
        redacted: acpReplay.redacted,
        chatId: acpReplay.filters.chatId,
        frames: acpReplay.frames.length,
        first: acpReplay.frames[0]
          ? [
              acpReplay.frames[0].sequence,
              acpReplay.frames[0].kind ?? acpReplay.frames[0].message,
              acpReplay.frames[0].elapsedMs,
              acpReplay.frames[0].deltaMs,
            ]
          : null,
        last: acpReplay.frames.at(-1)
          ? [
              acpReplay.frames.at(-1)?.sequence,
              acpReplay.frames.at(-1)?.kind ?? acpReplay.frames.at(-1)?.message,
              acpReplay.frames.at(-1)?.elapsedMs,
              acpReplay.frames.at(-1)?.deltaMs,
            ]
          : null,
        correlations: acpReplay.correlations.length,
      })
    );
    if (acpReplay.schemaVersion !== 1 || acpReplay.redacted !== true) {
      throw new Error("ACP replay did not declare its redacted schema.");
    }
    if (acpReplay.filters.chatId !== chatId) {
      throw new Error("ACP replay did not preserve the active chat filter.");
    }
    if (acpReplay.frames.length === 0) {
      throw new Error("Expected ACP replay frames for the active chat.");
    }
    if (acpReplay.frames.some((frame) => frame.chatId !== chatId)) {
      throw new Error("ACP replay included frames outside the active chat.");
    }
    if (
      acpReplay.frames.some((frame, index, frames) => {
        const previous = frames[index - 1];
        return previous ? frame.timestamp < previous.timestamp : false;
      })
    ) {
      throw new Error("ACP replay frames were not chronological.");
    }
    if (acpReplay.frames.some((frame, index) => frame.sequence !== index + 1)) {
      throw new Error("ACP replay frame sequence was not stable.");
    }
    if (!acpReplay.correlations.some((correlation) => correlation.chatId === chatId)) {
      throw new Error("Expected ACP replay correlation for the active chat.");
    }
    if (JSON.stringify(acpReplay).includes("rawPayload")) {
      throw new Error("ACP replay leaked rawPayload metadata.");
    }
  } finally {
    let cleanupError: unknown;
    try {
      if (subscriptionId) {
        await host.unsubscribeOperation(subscriptionId).catch(() => undefined);
        console.log("SUBSCRIPTION_STOPPED", subscriptionId);
      }
      if (chatId) {
        await request<unknown>(
          operation("mutation", "stopSession", { chatId })
        ).catch((error) => {
          cleanupError = error;
          console.log(
            "SESSION_STOP_FAILED",
            error instanceof Error ? error.message : String(error)
          );
        });
        console.log("SESSION_STOPPED", chatId);
        if (sessionLifecycleHooksBackup !== undefined && cleanupError === undefined) {
          const stopLifecycleRun = await waitForHookRun(
            "desktop-smoke-agent-stop-hook",
            "desktop agent lifecycle after-agent-session-stop"
          );
          console.log(
            "HOOK_AGENT_LIFECYCLE_STOP",
            JSON.stringify({
              status: stopLifecycleRun.status,
              stdout: stopLifecycleRun.stdout,
            })
          );
        }
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      if (sessionLifecycleHooksBackup !== undefined) {
        await restoreOptionalFile(hooksPath, sessionLifecycleHooksBackup);
        sessionLifecycleHooksBackup = undefined;
      }
      await host.stop();
      console.log("HOST_STOPPED");
    }
    if (previousMcpAuth === undefined) {
      delete process.env.ERAGEAR_DESKTOP_MCP_AUTH;
    } else {
      process.env.ERAGEAR_DESKTOP_MCP_AUTH = previousMcpAuth;
    }
    if (previousAllowedAgentPolicies === undefined) {
      delete process.env.ALLOWED_AGENT_COMMAND_POLICIES;
    } else {
      process.env.ALLOWED_AGENT_COMMAND_POLICIES = previousAllowedAgentPolicies;
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  }
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await host.stop().catch(() => undefined);
  process.exit(1);
});
