import type { ChildProcess } from "node:child_process";
import type * as acp from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { CLIENT_INFO } from "@/config/constants";
import { AppError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import {
  type ProcessTerminationPolicy,
  terminateProcessGracefully,
} from "@/shared/utils/process-termination.util";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type { SessionAgentResolverService } from "./session-agent-resolver.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";
import type { SpawnSessionProcessService } from "./spawn-session-process.service";

const OP = "session.discovery.agent_list";
const AUTH_REQUIRED_ERROR_CODE = -32_000;
const METHOD_NOT_FOUND_ERROR_CODE = -32_601;

interface InitializeCapabilities {
  loadSession?: unknown;
  sessionCapabilities?: {
    list?: unknown;
    resume?: unknown;
  };
}

export interface DiscoverAgentSessionsInput {
  userId: string;
  projectId: string;
  agentId?: string;
  cursor?: string;
}

export interface DiscoverAgentSessionItem {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface DiscoverAgentSessionsResult {
  supported: boolean;
  requiresAuth: boolean;
  loadSessionSupported: boolean;
  sessions: DiscoverAgentSessionItem[];
  nextCursor: string | null;
  agentInfo: { name: string; title?: string; version: string } | null;
  authMethods: Array<{ name: string; id: string; description: string }> | null;
}

function createDiscoveryClient(): acp.Client {
  return {
    requestPermission() {
      return {
        outcome: {
          outcome: "cancelled",
        },
      };
    },
    sessionUpdate() {
      // Discovery connection does not stream UI updates.
    },
  };
}

function isRequestErrorWithCode(error: unknown, code: number): boolean {
  return error instanceof RequestError && error.code === code;
}

function toAgentInfo(
  value:
    | {
        name?: string;
        title?: string | null;
        version?: string;
      }
    | null
    | undefined
): DiscoverAgentSessionsResult["agentInfo"] {
  if (!(value?.name && value.version)) {
    return null;
  }
  if (typeof value.title === "string" && value.title.length > 0) {
    return {
      name: value.name,
      title: value.title,
      version: value.version,
    };
  }
  return {
    name: value.name,
    version: value.version,
  };
}

function toAuthMethods(
  methods: Array<{ name: string; id: string; description: string }> | undefined
): DiscoverAgentSessionsResult["authMethods"] {
  if (!methods || methods.length === 0) {
    return null;
  }
  return methods;
}

export class DiscoverAgentSessionsService {
  private readonly projectContextResolver: SessionProjectContextResolverService;
  private readonly sessionAgentResolver: SessionAgentResolverService;
  private readonly spawnSessionProcess: SpawnSessionProcessService;
  private readonly agentRuntime: AgentRuntimePort;
  private readonly logger: LoggerPort;
  private readonly terminateProcess: (
    proc: ChildProcess,
    policy?: ProcessTerminationPolicy
  ) => Promise<unknown>;

  constructor(
    projectContextResolver: SessionProjectContextResolverService,
    sessionAgentResolver: SessionAgentResolverService,
    spawnSessionProcess: SpawnSessionProcessService,
    agentRuntime: AgentRuntimePort,
    logger: LoggerPort,
    terminateProcess: (
      proc: ChildProcess,
      policy?: ProcessTerminationPolicy
    ) => Promise<unknown> = terminateProcessGracefully
  ) {
    this.projectContextResolver = projectContextResolver;
    this.sessionAgentResolver = sessionAgentResolver;
    this.spawnSessionProcess = spawnSessionProcess;
    this.agentRuntime = agentRuntime;
    this.logger = logger;
    this.terminateProcess = terminateProcess;
  }

  async execute(
    input: DiscoverAgentSessionsInput
  ): Promise<DiscoverAgentSessionsResult> {
    const { userId, projectId, agentId, cursor } = input;
    const { projectRoot } = await this.projectContextResolver.resolve({
      userId,
      projectId,
    });
    const resolvedAgent = await this.sessionAgentResolver.resolve({
      userId,
      projectId,
      agentId,
    });

    const agentCommand = resolvedAgent.command;
    const agentArgs =
      resolvedAgent.args ?? (agentCommand === "opencode" ? ["acp"] : []);
    const agentEnv = resolvedAgent.env ?? {};

    const proc = this.spawnSessionProcess.execute({
      projectRoot,
      agentCommand,
      agentArgs,
      agentEnv,
    });

    try {
      const conn = this.agentRuntime.createAcpConnection(
        proc,
        createDiscoveryClient()
      );

      let initResult: acp.InitializeResponse;
      try {
        initResult = await conn.initialize({
          protocolVersion: 1,
          clientInfo: CLIENT_INFO,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        });
      } catch (error) {
        if (isRequestErrorWithCode(error, AUTH_REQUIRED_ERROR_CODE)) {
          return {
            supported: false,
            requiresAuth: true,
            loadSessionSupported: false,
            sessions: [],
            nextCursor: null,
            agentInfo: null,
            authMethods: null,
          };
        }
        throw error;
      }

      if (initResult.protocolVersion !== 1) {
        throw new AppError({
          code: "AGENT_PROTOCOL_MISMATCH",
          statusCode: 500,
          module: "session",
          op: OP,
          message: `Agent protocol version mismatch: ${initResult.protocolVersion}`,
          details: {
            protocolVersion: initResult.protocolVersion,
            projectId,
            agentId: agentId ?? null,
          },
        });
      }

      const agentCapabilities = initResult.agentCapabilities as
        | InitializeCapabilities
        | undefined;
      const hasListCapability = Boolean(
        agentCapabilities?.sessionCapabilities?.list
      );
      const loadSessionSupported = Boolean(
        agentCapabilities?.loadSession ||
          agentCapabilities?.sessionCapabilities?.resume
      );
      const agentInfo = toAgentInfo(initResult.agentInfo);
      const authMethods = toAuthMethods(
        initResult.authMethods as
          | Array<{ name: string; id: string; description: string }>
          | undefined
      );

      if (!hasListCapability) {
        return {
          supported: false,
          requiresAuth: false,
          loadSessionSupported,
          sessions: [],
          nextCursor: null,
          agentInfo,
          authMethods,
        };
      }

      try {
        const listResult = await conn.unstable_listSessions({
          cwd: projectRoot,
          ...(cursor ? { cursor } : {}),
        });

        return {
          supported: true,
          requiresAuth: false,
          loadSessionSupported,
          sessions: listResult.sessions.map((session) => ({
            sessionId: session.sessionId,
            cwd: session.cwd,
            title: session.title ?? null,
            updatedAt: session.updatedAt ?? null,
          })),
          nextCursor: listResult.nextCursor ?? null,
          agentInfo,
          authMethods,
        };
      } catch (error) {
        if (isRequestErrorWithCode(error, AUTH_REQUIRED_ERROR_CODE)) {
          return {
            supported: true,
            requiresAuth: true,
            loadSessionSupported,
            sessions: [],
            nextCursor: null,
            agentInfo,
            authMethods,
          };
        }
        if (isRequestErrorWithCode(error, METHOD_NOT_FOUND_ERROR_CODE)) {
          return {
            supported: false,
            requiresAuth: false,
            loadSessionSupported,
            sessions: [],
            nextCursor: null,
            agentInfo,
            authMethods,
          };
        }
        throw error;
      }
    } finally {
      await this.terminateProcess(proc, {
        forceWindowsTreeTermination: true,
      }).catch((error) => {
        this.logger.warn("Failed to terminate discovery ACP process", {
          projectId,
          agentId: agentId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}
