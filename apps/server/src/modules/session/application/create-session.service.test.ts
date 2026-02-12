import { describe, expect, test } from "bun:test";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { BootstrapSessionConnectionService } from "./bootstrap-session-connection.service";
import { CreateSessionService } from "./create-session.service";
import type { PersistSessionBootstrapService } from "./persist-session-bootstrap.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";
import type { SpawnSessionProcessService } from "./spawn-session-process.service";

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
    const spawnCalls: Array<Record<string, unknown>> = [];
    const bootstrapCalls: Array<Record<string, unknown>> = [];
    const persistCalls: Array<Record<string, unknown>> = [];
    const proc = {} as ChatSession["proc"];

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

    const spawnSessionProcess = {
      execute: (input: Record<string, unknown>) => {
        spawnCalls.push(input);
        return proc;
      },
    } as unknown as SpawnSessionProcessService;

    const bootstrapSessionConnection = {
      execute: async (input: Record<string, unknown>) => {
        bootstrapCalls.push(input);
        return { chatSession };
      },
    } as unknown as BootstrapSessionConnectionService;

    const persistSessionBootstrap = {
      execute: async (input: Record<string, unknown>) => {
        persistCalls.push(input);
      },
    } as unknown as PersistSessionBootstrapService;

    const service = new CreateSessionService(
      projectContextResolver,
      spawnSessionProcess,
      bootstrapSessionConnection,
      persistSessionBootstrap,
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
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      projectRoot: "/resolved/project",
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });
    expect(bootstrapCalls).toHaveLength(1);
    expect(bootstrapCalls[0]).toMatchObject({
      chatId: "chat-1",
      projectId: "project-1",
      projectRoot: "/resolved/project",
      params,
      proc,
    });
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]).toMatchObject({
      chatId: "chat-1",
      projectRoot: "/resolved/project",
      params,
      chatSession,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });
  });

  test("uses empty args for non-opencode command when args are omitted", async () => {
    const chatSession = createChatSession("chat-2", "user-1");
    const spawnCalls: Array<Record<string, unknown>> = [];

    const projectContextResolver = {
      resolve: async () => ({ projectId: "project-2", projectRoot: "/repo" }),
    } as unknown as SessionProjectContextResolverService;

    const spawnSessionProcess = {
      execute: (input: Record<string, unknown>) => {
        spawnCalls.push(input);
        return {} as ChatSession["proc"];
      },
    } as unknown as SpawnSessionProcessService;

    const service = new CreateSessionService(
      projectContextResolver,
      spawnSessionProcess,
      {
        execute: async () => ({ chatSession }),
      } as unknown as BootstrapSessionConnectionService,
      {
        execute: async () => undefined,
      } as unknown as PersistSessionBootstrapService,
      createLoggerStub()
    );

    await service.execute({
      userId: "user-1",
      chatId: "chat-2",
      projectRoot: "/repo",
      command: "codex",
      env: { MODE: "strict" },
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: { MODE: "strict" },
    });
  });
});
