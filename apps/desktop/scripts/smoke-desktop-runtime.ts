import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

interface LocalAdeSnapshot {
  projectRoot: string;
  providers: Array<{
    id: string;
    status: string;
    cliStatus?: string;
    authStatus?: string;
    modelStatus?: string;
    version?: string;
  }>;
  mcp: {
    configPath: string;
    servers: Array<{
      name: string;
      health: string;
      protocol: {
        status: string;
        toolsDiscovered: number;
        resourcesDiscovered: number;
      };
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string; name?: string }>;
    }>;
  };
  checkpoints: {
    items: Array<{ id: string; patchBytes: number }>;
  };
  capabilities: {
    capabilities: CapabilitySummary[];
  };
  projectMemory: {
    sources: Array<{ relativePath: string }>;
  };
  subagents: Array<{ name: string; enabled: boolean; sourcePath: string }>;
  blockers: Array<{ workflow: string }>;
}

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const smokeMcpScript = path.join(desktopRoot, "scripts", "mcp-smoke-server.js");
const token = `smoke-${Date.now()}`;
const promptWaitMs = Number(process.env.ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS ?? 20_000);

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

    await withFileBackup(ade.mcp.configPath, async () => {
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
      const smokeMcp = mcpSnapshot.mcp.servers.find(
        (server) => server.name === "Desktop Smoke MCP"
      );
      console.log(
        "MCP_DISCOVERY",
        JSON.stringify({
          health: smokeMcp?.health ?? "missing",
          protocol: smokeMcp?.protocol.status ?? "missing",
          tools: smokeMcp?.tools.map((tool) => tool.name) ?? [],
          resources:
            smokeMcp?.resources.map((resource) => resource.name ?? resource.uri) ?? [],
        })
      );
      if (
        smokeMcp?.health !== "available" ||
        smokeMcp.protocol.status !== "initialized" ||
        !smokeMcp.tools.some((tool) => tool.name === "desktop_smoke_tool")
      ) {
        throw new Error("Desktop smoke MCP protocol discovery did not complete.");
      }
    });

    const agent = await chooseAgent();
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

    const sent = await request<unknown>(
      operation("mutation", "sendMessage", {
        chatId,
        text: "Reply with exactly: desktop IPC smoke ok",
      })
    );
    console.log("MESSAGE_SENT", JSON.stringify(sent));
    await wait(promptWaitMs);
    console.log(
      "MESSAGE_OBSERVED",
      JSON.stringify({ assistantSeen: subscription.assistantSeen() })
    );
  } finally {
    if (subscriptionId) {
      await host.unsubscribeOperation(subscriptionId).catch(() => undefined);
      console.log("SUBSCRIPTION_STOPPED", subscriptionId);
    }
    if (chatId) {
      await request<unknown>(
        operation("mutation", "stopSession", { chatId })
      ).catch((error) => {
        console.log(
          "SESSION_STOP_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      });
      console.log("SESSION_STOPPED", chatId);
    }
    await host.stop();
    console.log("HOST_STOPPED");
  }
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await host.stop().catch(() => undefined);
  process.exit(1);
});
