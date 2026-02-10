import { describe, expect, test } from "bun:test";
import type { SessionBufferingPort } from "@/modules/session/application/ports/session-acp.port";
import type { BroadcastEvent, ChatSession, Plan } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SessionOrchestratorService } from "./session-orchestrator.service";

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
    chatStatus: "connecting",
  } satisfies Partial<ChatSession> as ChatSession;
}

function createBufferStub(): SessionBufferingPort {
  return {
    replayEventCount: 0,
    appendContent: () => undefined,
    appendReasoning: () => undefined,
    flush: () => null,
    hasContent: () => false,
    reset: () => undefined,
    getMessageId: () => null,
    ensureMessageId: () => "message-1",
  };
}

describe("SessionOrchestratorService", () => {
  test("runs session bootstrap lifecycle and reuses stored plan when chatId is provided", async () => {
    const broadcastEvents: BroadcastEvent[] = [];
    const plan: Plan = {
      entries: [{ content: "Investigate", priority: "high", status: "pending" }],
    };
    const proc = { pid: 123, killed: false, kill: () => true } as unknown as ChatSession["proc"];
    const chatSession = createChatSession("chat-1", "user-1");
    const buffer = createBufferStub();

    const findByIdCalls: Array<{ id: string; userId: string }> = [];
    const prepareCalls: Array<Record<string, unknown>> = [];
    const bootstrapCalls: Array<Record<string, unknown>> = [];
    const attachCalls: Array<{ proc: ChatSession["proc"]; chatId: string }> = [];
    const persistCalls: Array<Record<string, unknown>> = [];

    const sessionRepo = {
      findById: async (id: string, userId: string) => {
        findByIdCalls.push({ id, userId });
        return { plan } as { plan?: Plan };
      },
    };
    const sessionRuntime = {
      broadcast: (_chatId: string, event: BroadcastEvent) => {
        broadcastEvents.push(event);
      },
    };
    const agentRuntime = {
      spawn: () => proc,
    };
    const runtimeBootstrap = {
      prepare: async (input: Record<string, unknown>) => {
        prepareCalls.push(input);
        return { chatSession, buffer };
      },
    };
    const acpBootstrap = {
      bootstrap: async (input: Record<string, unknown>) => {
        bootstrapCalls.push(input);
      },
    };
    const processLifecycle = {
      attach: (attachedProc: ChatSession["proc"], chatId: string) => {
        attachCalls.push({ proc: attachedProc, chatId });
      },
    };
    const metadataPersistence = {
      persist: async (input: Record<string, unknown>) => {
        persistCalls.push(input);
      },
    };

    const service = new SessionOrchestratorService(
      sessionRepo as never,
      sessionRuntime as never,
      agentRuntime as never,
      runtimeBootstrap as never,
      acpBootstrap as never,
      processLifecycle as never,
      metadataPersistence as never
    );

    const params = {
      userId: "user-1",
      chatId: "chat-1",
      projectRoot: "/repo",
      sessionIdToLoad: "session-1",
    };
    const result = await service.execute({
      chatId: "chat-1",
      projectId: "project-1",
      projectRoot: "/repo",
      params,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: { TEST: "1" },
    });

    expect(result).toBe(chatSession);
    expect(findByIdCalls).toEqual([{ id: "chat-1", userId: "user-1" }]);
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0]).toMatchObject({
      chatId: "chat-1",
      userId: "user-1",
      proc,
      projectId: "project-1",
      projectRoot: "/repo",
      sessionIdToLoad: "session-1",
      plan,
    });
    expect(bootstrapCalls).toEqual([
      {
        chatId: "chat-1",
        chatSession,
        buffer,
        projectRoot: "/repo",
        sessionIdToLoad: "session-1",
      },
    ]);
    expect(attachCalls).toEqual([{ proc, chatId: "chat-1" }]);
    expect(persistCalls).toEqual([
      {
        chatId: "chat-1",
        params,
        chatSession,
        agentCommand: "opencode",
        agentArgs: ["acp"],
        agentEnv: { TEST: "1" },
        projectRoot: "/repo",
      },
    ]);
    expect(chatSession.chatStatus).toBe("ready");
    expect(broadcastEvents).toEqual([
      {
        type: "chat_status",
        status: "ready",
      },
    ]);
  });

  test("skips stored session lookup when params.chatId is absent", async () => {
    const proc = { pid: 321, killed: false, kill: () => true } as unknown as ChatSession["proc"];
    const chatSession = createChatSession("chat-2", "user-2");
    const buffer = createBufferStub();
    const prepareCalls: Array<Record<string, unknown>> = [];
    let findByIdCount = 0;

    const service = new SessionOrchestratorService(
      {
        findById: async () => {
          findByIdCount += 1;
          return undefined;
        },
      } as never,
      {
        broadcast: () => undefined,
      } as never,
      {
        spawn: () => proc,
      } as never,
      {
        prepare: async (input: Record<string, unknown>) => {
          prepareCalls.push(input);
          return { chatSession, buffer };
        },
      } as never,
      {
        bootstrap: async () => undefined,
      } as never,
      {
        attach: () => undefined,
      } as never,
      {
        persist: async () => undefined,
      } as never
    );

    await service.execute({
      chatId: "chat-2",
      projectRoot: "/repo-2",
      params: {
        userId: "user-2",
        projectRoot: "/repo-2",
      },
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: {},
    });

    expect(findByIdCount).toBe(0);
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0]?.plan).toBeUndefined();
  });
});
