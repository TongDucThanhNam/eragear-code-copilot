import path from "node:path";
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
  providers: Array<{ id: string; status: string; version?: string }>;
  mcp: {
    servers: Array<{ name: string; health: string }>;
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
  blockers: Array<{ workflow: string }>;
}

const desktopRoot = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
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
          provider.version ?? null,
        ]),
        mcp: ade.mcp.servers.map((server) => [server.name, server.health]),
        checkpoints: ade.checkpoints.items.length,
        commands: ade.capabilities.capabilities
          .filter((item) => item.kind === "command")
          .map((item) => item.name),
        memory: ade.projectMemory.sources.map((source) => source.relativePath),
        blockers: ade.blockers.map((blocker) => blocker.workflow),
      })
    );

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
        providerVersion: testedProvider?.version ?? null,
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
