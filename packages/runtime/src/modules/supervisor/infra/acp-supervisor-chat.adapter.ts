import { createId } from "#runtime/shared/utils/id.util";
import type {
  SupervisorChatPort,
  SupervisorChatResponse,
  SupervisorChatSnapshot,
} from "../application/ports/supervisor-chat.port";

const RESULT_POLL_INTERVAL_MS = 100;
const RESULT_TIMEOUT_MS = 18_000;

interface AcpChatSessionPort {
  execute(input: {
    userId: string;
    projectId?: string;
    projectRoot?: string;
    agentId?: string;
    chatId?: string;
  }): Promise<{ id: string; sessionId?: string }>;
}

interface AcpChatMessagePort {
  execute(input: {
    userId: string;
    chatId: string;
    text: string;
    source: "orchestrator";
  }): Promise<{ turnId: string }>;
}

interface AcpChatStopPort {
  execute(userId: string, chatId: string): Promise<unknown>;
}

interface AcpChatResultPort {
  latestAssistantText(input: {
    userId: string;
    chatId: string;
  }): Promise<string | null>;
}

interface AcpChatAgentPort {
  list(input: {
    userId: string;
    projectId?: string;
  }): Promise<Array<{ agentId: string; displayName: string }>>;
}

/**
 * Runs advisory Supervisos chat through a short-lived ACP session.
 *
 * Implementation requests never reach this adapter: SupervisorChatService
 * converts those messages into durable Goal Drafts owned by the sticky manager.
 */
export class AcpSupervisorChatAdapter implements SupervisorChatPort {
  private readonly deps: {
    createSession: AcpChatSessionPort;
    sendMessage: AcpChatMessagePort;
    stopSession: AcpChatStopPort;
    results: AcpChatResultPort;
    agents: AcpChatAgentPort;
    now?: () => number;
    createId?: (prefix: string) => string;
  };

  constructor(deps: {
    createSession: AcpChatSessionPort;
    sendMessage: AcpChatMessagePort;
    stopSession: AcpChatStopPort;
    results: AcpChatResultPort;
    agents: AcpChatAgentPort;
    now?: () => number;
    createId?: (prefix: string) => string;
  }) {
    this.deps = deps;
  }

  async respond(
    input: SupervisorChatSnapshot
  ): Promise<SupervisorChatResponse> {
    const agents = await this.deps.agents.list({
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    const agent = agents[0];
    if (!agent) {
      throw new Error("No ACP manager-capable agent is configured");
    }
    const chatId = (this.deps.createId ?? createId)("supervisor-advisory");
    const created = await this.deps.createSession.execute({
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      projectRoot: input.projectRoot,
      agentId: agent.agentId,
      chatId,
    });
    if (created.id !== chatId || !created.sessionId) {
      await this.deps.stopSession
        .execute(input.userId, created.id)
        .catch(() => undefined);
      throw new Error("ACP advisory session is not exact-resumable");
    }
    try {
      await this.deps.sendMessage.execute({
        userId: input.userId,
        chatId,
        text: buildAdvisoryPrompt(input),
        source: "orchestrator",
      });
      const content = await waitForAssistantResult({
        userId: input.userId,
        chatId,
        results: this.deps.results,
        now: this.deps.now ?? Date.now,
      });
      return {
        content,
        model: `ACP · ${agent.displayName}`,
        provider: "acp",
      };
    } finally {
      await this.deps.stopSession
        .execute(input.userId, chatId)
        .catch(() => undefined);
    }
  }
}

function buildAdvisoryPrompt(input: SupervisorChatSnapshot): string {
  return [
    "You are the read-only Supervisos engineering manager advisory channel.",
    "Answer the user's question concisely using only the bounded context below.",
    "Do not propose shell commands as user authorization. Do not claim that work was executed.",
    "If implementation is requested, tell the user to create/approve a Goal Draft.",
    "Return plain text, not JSON.",
    "",
    JSON.stringify({
      userMessage: input.userMessage.slice(0, 8000),
      projectContext: input.projectContext,
      projectIntelligence: input.projectIntelligence,
      plan: input.plan,
      goalModeAudit: input.goalModeAudit.slice(-6),
      sideChatHistory: input.sideChatHistory.slice(-12),
      supervisor: input.supervisor,
    }).slice(0, 48_000),
  ].join("\n");
}

async function waitForAssistantResult(input: {
  userId: string;
  chatId: string;
  results: AcpChatResultPort;
  now: () => number;
}): Promise<string> {
  const deadline = input.now() + RESULT_TIMEOUT_MS;
  while (input.now() < deadline) {
    const result = await input.results.latestAssistantText({
      userId: input.userId,
      chatId: input.chatId,
    });
    if (result?.trim()) {
      return result.trim().slice(0, 32_000);
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, RESULT_POLL_INTERVAL_MS)
    );
  }
  throw new Error("ACP advisory turn timed out");
}
