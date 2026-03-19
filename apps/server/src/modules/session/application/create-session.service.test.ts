import { describe, expect, test } from "bun:test";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { BootstrapSessionConnectionService } from "./bootstrap-session-connection.service";
import { CreateSessionService } from "./create-session.service";
import type { PersistSessionBootstrapService } from "./persist-session-bootstrap.service";
import type { SessionAgentResolverService } from "./session-agent-resolver.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";
import type { SpawnSessionProcessService } from "./spawn-session-process.service";

const BOOTSTRAP_FAILED_RE = /bootstrap failed/;

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
    const projectResolverCalls: Array<{
      userId: string;
      projectId?: string;
      projectRoot?: string;
    }> = [];
    const spawnCalls: Record<string, unknown>[] = [];
    const bootstrapCalls: Record<string, unknown>[] = [];
    const persistCalls: Record<string, unknown>[] = [];
    const agentResolverCalls: Record<string, unknown>[] = [];
    const proc = {} as ChatSession["proc"];

    const projectContextResolver = {
      resolve: (input: {
        userId: string;
        projectId?: string;
        projectRoot?: string;
      }) => {
        projectResolverCalls.push(input);
        return Promise.resolve({
          projectId: "project-1",
          projectRoot: "/resolved/project",
        });
      },
    } as unknown as SessionProjectContextResolverService;

    const spawnSessionProcess = {
      execute: (input: Record<string, unknown>) => {
        spawnCalls.push(input);
        return proc;
      },
    } as unknown as SpawnSessionProcessService;

    const sessionAgentResolver = {
      resolve: (input: Record<string, unknown>) => {
        agentResolverCalls.push(input);
        return Promise.resolve({
          agentId: "agent-1",
          command: "opencode",
        });
      },
    } as unknown as SessionAgentResolverService;

    const bootstrapSessionConnection = {
      execute: (input: Record<string, unknown>) => {
        bootstrapCalls.push(input);
        return Promise.resolve({ chatSession });
      },
    } as unknown as BootstrapSessionConnectionService;

    const persistSessionBootstrap = {
      execute: (input: Record<string, unknown>) => {
        persistCalls.push(input);
        return Promise.resolve();
      },
    } as unknown as PersistSessionBootstrapService;

    const service = new CreateSessionService(
      projectContextResolver,
      sessionAgentResolver,
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
    expect(projectResolverCalls).toEqual([
      {
        userId: "user-1",
        projectId: undefined,
        projectRoot: "/requested/project",
      },
    ]);
    expect(spawnCalls).toHaveLength(1);
    expect(agentResolverCalls).toEqual([
      {
        userId: "user-1",
        projectId: "project-1",
        agentId: undefined,
      },
    ]);
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
    const spawnCalls: Record<string, unknown>[] = [];
    const resolverCalls: Record<string, unknown>[] = [];

    const projectContextResolver = {
      resolve: async () => ({ projectId: "project-2", projectRoot: "/repo" }),
    } as unknown as SessionProjectContextResolverService;

    const spawnSessionProcess = {
      execute: (input: Record<string, unknown>) => {
        spawnCalls.push(input);
        return {} as ChatSession["proc"];
      },
    } as unknown as SpawnSessionProcessService;

    const sessionAgentResolver = {
      resolve: (input: Record<string, unknown>) => {
        resolverCalls.push(input);
        return Promise.resolve({
          agentId: "agent-2",
          command: "codex",
          args: [],
          env: { MODE: "strict" },
        });
      },
    } as unknown as SessionAgentResolverService;

    const service = new CreateSessionService(
      projectContextResolver,
      sessionAgentResolver,
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
      agentId: "agent-2",
    });

    expect(resolverCalls).toEqual([
      {
        userId: "user-1",
        projectId: "project-2",
        agentId: "agent-2",
      },
    ]);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: { MODE: "strict" },
    });
  });

  test("terminates spawned process when bootstrap fails", async () => {
    const proc = {} as ChatSession["proc"];
    const terminateCalls: Array<{
      proc: ChatSession["proc"];
      forceWindowsTreeTermination?: boolean;
    }> = [];

    const service = new CreateSessionService(
      {
        resolve: async () => ({
          projectId: "project-3",
          projectRoot: "/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: async () => ({
          agentId: "agent-3",
          command: "opencode",
          args: [],
          env: {},
        }),
      } as unknown as SessionAgentResolverService,
      {
        execute: () => proc,
      } as unknown as SpawnSessionProcessService,
      {
        execute: async () => {
          throw await new Error("bootstrap failed");
        },
      } as unknown as BootstrapSessionConnectionService,
      {
        execute: async () => undefined,
      } as unknown as PersistSessionBootstrapService,
      createLoggerStub(),
      async (targetProc, policy) => {
        await terminateCalls.push({
          proc: targetProc,
          forceWindowsTreeTermination: policy?.forceWindowsTreeTermination,
        });
      }
    );

    await expect(
      service.execute({
        userId: "user-1",
        projectId: "project-3",
      })
    ).rejects.toThrow(BOOTSTRAP_FAILED_RE);
    expect(terminateCalls).toEqual([
      {
        proc,
        forceWindowsTreeTermination: true,
      },
    ]);
  });

  test("uses trusted command overrides for internal resume flow", async () => {
    const chatSession = createChatSession("chat-4", "user-1");
    const spawnCalls: Record<string, unknown>[] = [];
    let resolverCallCount = 0;

    const service = new CreateSessionService(
      {
        resolve: async () => ({
          projectId: "project-4",
          projectRoot: "/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: () => {
          resolverCallCount += 1;
          return {
            agentId: "agent-x",
            command: "opencode",
            args: ["acp"],
            env: {},
          };
        },
      } as unknown as SessionAgentResolverService,
      {
        execute: (input: Record<string, unknown>) => {
          spawnCalls.push(input);
          return {} as ChatSession["proc"];
        },
      } as unknown as SpawnSessionProcessService,
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
      chatId: "chat-4",
      projectId: "project-4",
      command: "/usr/bin/codex",
      args: ["--json"],
      env: { CI: "1" },
      sessionIdToLoad: "session-1",
    });

    expect(resolverCallCount).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      agentCommand: "/usr/bin/codex",
      agentArgs: ["--json"],
      agentEnv: { CI: "1" },
    });
  });

  test("fails fast when resolved agent command is empty", async () => {
    const service = new CreateSessionService(
      {
        resolve: async () => ({
          projectId: "project-empty-command",
          projectRoot: "/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: async () => ({
          agentId: "agent-empty-command",
          command: " ",
          args: ["acp"],
          env: {},
        }),
      } as unknown as SessionAgentResolverService,
      {
        execute: () => ({}) as ChatSession["proc"],
      } as unknown as SpawnSessionProcessService,
      {
        execute: async () => ({
          chatSession: createChatSession("chat-5", "user-1"),
        }),
      } as unknown as BootstrapSessionConnectionService,
      {
        execute: async () => undefined,
      } as unknown as PersistSessionBootstrapService,
      createLoggerStub()
    );

    await expect(
      service.execute({
        userId: "user-1",
        projectId: "project-empty-command",
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "VALIDATION_ERROR",
    });
  });
});
