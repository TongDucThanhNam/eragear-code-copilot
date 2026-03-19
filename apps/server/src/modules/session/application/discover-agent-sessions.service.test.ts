import { describe, expect, test } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { DiscoverAgentSessionsService } from "./discover-agent-sessions.service";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type { SessionAgentResolverService } from "./session-agent-resolver.service";
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

describe("DiscoverAgentSessionsService", () => {
  test("lists sessions when agent advertises sessionCapabilities.list", async () => {
    const projectResolverCalls: Array<{ userId: string; projectId: string }> =
      [];
    const agentResolverCalls: Array<{
      userId: string;
      projectId: string;
      agentId?: string;
    }> = [];
    const spawnCalls: Array<{
      projectRoot: string;
      agentCommand: string;
      agentArgs: string[];
      agentEnv: Record<string, string>;
    }> = [];
    const listCalls: Array<{ cwd?: string | null; cursor?: string | null }> =
      [];
    const terminateCalls: unknown[] = [];
    const proc = {} as ReturnType<SpawnSessionProcessService["execute"]>;

    const service = new DiscoverAgentSessionsService(
      {
        resolve: (input: { userId: string; projectId: string }) => {
          projectResolverCalls.push(input);
          return { projectId: input.projectId, projectRoot: "/workspace/repo" };
        },
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: (input: {
          userId: string;
          projectId: string;
          agentId?: string;
        }) => {
          agentResolverCalls.push(input);
          return {
            agentId: "agent-1",
            command: "opencode",
            args: undefined,
            env: { CI: "1" },
          };
        },
      } as unknown as SessionAgentResolverService,
      {
        execute: (input: {
          projectRoot: string;
          agentCommand: string;
          agentArgs: string[];
          agentEnv: Record<string, string>;
        }) => {
          spawnCalls.push(input);
          return proc;
        },
      } as unknown as SpawnSessionProcessService,
      {
        createAcpConnection: () =>
          ({
            initialize: () => ({
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: true,
                sessionCapabilities: {
                  list: {},
                  resume: {},
                },
              },
              agentInfo: {
                name: "opencode",
                title: "OpenCode",
                version: "1.2.15",
              },
              authMethods: [
                {
                  id: "opencode-login",
                  name: "Login with opencode",
                  description: "Run opencode auth login",
                },
              ],
            }),
            unstable_listSessions: (params: {
              cwd?: string | null;
              cursor?: string | null;
            }) => {
              listCalls.push(params);
              return {
                sessions: [
                  {
                    sessionId: "sess-1",
                    cwd: "/workspace/repo",
                    title: "Implement API",
                    updatedAt: "2026-02-28T03:00:00Z",
                  },
                ],
                nextCursor: "cursor-2",
              };
            },
          }) as never,
      } as unknown as AgentRuntimePort,
      createLoggerStub(),
      (...args) => {
        terminateCalls.push(args);
      }
    );

    const result = await service.execute({
      userId: "user-1",
      projectId: "project-1",
      agentId: "agent-1",
      cursor: "cursor-1",
    });

    expect(projectResolverCalls).toEqual([
      { userId: "user-1", projectId: "project-1" },
    ]);
    expect(agentResolverCalls).toEqual([
      {
        userId: "user-1",
        projectId: "project-1",
        agentId: "agent-1",
      },
    ]);
    expect(spawnCalls).toEqual([
      {
        projectRoot: "/workspace/repo",
        agentCommand: "opencode",
        agentArgs: ["acp"],
        agentEnv: { CI: "1" },
      },
    ]);
    expect(listCalls).toEqual([{ cwd: "/workspace/repo", cursor: "cursor-1" }]);
    expect(result).toEqual({
      supported: true,
      requiresAuth: false,
      loadSessionSupported: true,
      sessions: [
        {
          sessionId: "sess-1",
          cwd: "/workspace/repo",
          title: "Implement API",
          updatedAt: "2026-02-28T03:00:00Z",
        },
      ],
      nextCursor: "cursor-2",
      agentInfo: {
        name: "opencode",
        title: "OpenCode",
        version: "1.2.15",
      },
      authMethods: [
        {
          id: "opencode-login",
          name: "Login with opencode",
          description: "Run opencode auth login",
        },
      ],
    });
    expect(terminateCalls).toHaveLength(1);
  });

  test("returns unsupported when list capability is absent", async () => {
    const listCalls: unknown[] = [];

    const service = new DiscoverAgentSessionsService(
      {
        resolve: async () => ({
          projectId: "project-1",
          projectRoot: "/workspace/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: async () => ({
          agentId: "agent-1",
          command: "codex-acp",
          args: [],
          env: {},
        }),
      } as unknown as SessionAgentResolverService,
      {
        execute: () =>
          ({}) as ReturnType<SpawnSessionProcessService["execute"]>,
      } as unknown as SpawnSessionProcessService,
      {
        createAcpConnection: () =>
          ({
            initialize: () => ({
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: true,
              },
              agentInfo: {
                name: "codex-acp",
                title: "Codex",
                version: "0.9.1",
              },
            }),
            unstable_listSessions: () => {
              listCalls.push(true);
              return { sessions: [] };
            },
          }) as never,
      } as unknown as AgentRuntimePort,
      createLoggerStub(),
      () => undefined
    );

    const result = await service.execute({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(result).toEqual({
      supported: false,
      requiresAuth: false,
      loadSessionSupported: true,
      sessions: [],
      nextCursor: null,
      agentInfo: {
        name: "codex-acp",
        title: "Codex",
        version: "0.9.1",
      },
      authMethods: null,
    });
    expect(listCalls).toHaveLength(0);
  });

  test("returns requiresAuth when initialize returns auth_required", async () => {
    const service = new DiscoverAgentSessionsService(
      {
        resolve: async () => ({
          projectId: "project-1",
          projectRoot: "/workspace/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: async () => ({
          agentId: "agent-1",
          command: "claude-code-acp",
          args: [],
          env: {},
        }),
      } as unknown as SessionAgentResolverService,
      {
        execute: () =>
          ({}) as ReturnType<SpawnSessionProcessService["execute"]>,
      } as unknown as SpawnSessionProcessService,
      {
        createAcpConnection: () =>
          ({
            initialize: () => {
              throw RequestError.authRequired();
            },
          }) as never,
      } as unknown as AgentRuntimePort,
      createLoggerStub(),
      () => undefined
    );

    const result = await service.execute({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(result).toEqual({
      supported: false,
      requiresAuth: true,
      loadSessionSupported: false,
      sessions: [],
      nextCursor: null,
      agentInfo: null,
      authMethods: null,
    });
  });

  test("treats method-not-found during list as unsupported", async () => {
    const service = new DiscoverAgentSessionsService(
      {
        resolve: async () => ({
          projectId: "project-1",
          projectRoot: "/workspace/repo",
        }),
      } as unknown as SessionProjectContextResolverService,
      {
        resolve: async () => ({
          agentId: "agent-1",
          command: "custom-agent",
          args: [],
          env: {},
        }),
      } as unknown as SessionAgentResolverService,
      {
        execute: () =>
          ({}) as ReturnType<SpawnSessionProcessService["execute"]>,
      } as unknown as SpawnSessionProcessService,
      {
        createAcpConnection: () =>
          ({
            initialize: () => ({
              protocolVersion: 1,
              agentCapabilities: {
                sessionCapabilities: {
                  list: {},
                },
              },
              agentInfo: {
                name: "custom-agent",
                version: "1.0.0",
              },
            }),
            unstable_listSessions: () => {
              throw RequestError.methodNotFound("session/list");
            },
          }) as never,
      } as unknown as AgentRuntimePort,
      createLoggerStub(),
      () => undefined
    );

    const result = await service.execute({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(result).toEqual({
      supported: false,
      requiresAuth: false,
      loadSessionSupported: false,
      sessions: [],
      nextCursor: null,
      agentInfo: {
        name: "custom-agent",
        version: "1.0.0",
      },
      authMethods: null,
    });
  });
});
