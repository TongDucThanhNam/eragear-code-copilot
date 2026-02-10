import { describe, expect, test } from "bun:test";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { CreateSessionService } from "./create-session.service";
import type { SessionOrchestratorService } from "./session-orchestrator.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";

function createLoggerStub(): LoggerPort {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function createChatSession(chatId: string, userId: string): ChatSession {
  return {
    id: chatId,
    userId,
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("CreateSessionService", () => {
  test("resolves project context and delegates with default opencode args", async () => {
    const chatSession = createChatSession("chat-1", "user-1");
    const resolverCalls: Array<{
      userId: string;
      projectId?: string;
      projectRoot?: string;
    }> = [];
    const orchestratorCalls: Array<Record<string, unknown>> = [];

    const projectContextResolver = {
      resolve: async (input: {
        userId: string;
        projectId?: string;
        projectRoot?: string;
      }) => {
        resolverCalls.push(input);
        return { projectId: "project-1", projectRoot: "/resolved/project" };
      },
    } as unknown as SessionProjectContextResolverService;

    const sessionOrchestrator = {
      execute: async (input: Record<string, unknown>) => {
        orchestratorCalls.push(input);
        return chatSession;
      },
    } as unknown as SessionOrchestratorService;

    const service = new CreateSessionService(
      projectContextResolver,
      sessionOrchestrator,
      createLoggerStub()
    );

    const params = {
      userId: "user-1",
      chatId: "chat-1",
      projectRoot: "/requested/project",
    };
    const result = await service.execute(params);

    expect(result).toBe(chatSession);
    expect(resolverCalls).toEqual([
      {
        userId: "user-1",
        projectId: undefined,
        projectRoot: "/requested/project",
      },
    ]);
    expect(orchestratorCalls).toHaveLength(1);
    expect(orchestratorCalls[0]).toMatchObject({
      chatId: "chat-1",
      projectId: "project-1",
      projectRoot: "/resolved/project",
      params,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });
  });

  test("uses empty args for non-opencode command when args are omitted", async () => {
    const chatSession = createChatSession("chat-2", "user-1");
    const orchestratorCalls: Array<Record<string, unknown>> = [];

    const projectContextResolver = {
      resolve: async () => ({ projectId: "project-2", projectRoot: "/repo" }),
    } as unknown as SessionProjectContextResolverService;

    const sessionOrchestrator = {
      execute: async (input: Record<string, unknown>) => {
        orchestratorCalls.push(input);
        return chatSession;
      },
    } as unknown as SessionOrchestratorService;

    const service = new CreateSessionService(
      projectContextResolver,
      sessionOrchestrator,
      createLoggerStub()
    );

    await service.execute({
      userId: "user-1",
      chatId: "chat-2",
      projectRoot: "/repo",
      command: "codex",
      env: { MODE: "strict" },
    });

    expect(orchestratorCalls).toHaveLength(1);
    expect(orchestratorCalls[0]).toMatchObject({
      chatId: "chat-2",
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: { MODE: "strict" },
    });
  });
});
