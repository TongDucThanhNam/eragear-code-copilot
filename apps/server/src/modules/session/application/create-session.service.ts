import crypto from "node:crypto";
import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import {
  type ProcessTerminationPolicy,
  terminateProcessGracefully,
} from "@/shared/utils/process-termination.util";
import type { BootstrapSessionConnectionService } from "./bootstrap-session-connection.service";
import type { CreateSessionParams } from "./create-session.types";
import type { PersistSessionBootstrapService } from "./persist-session-bootstrap.service";
import type { SessionAgentResolverService } from "./session-agent-resolver.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";
import type { SpawnSessionProcessService } from "./spawn-session-process.service";

export type { CreateSessionParams } from "./create-session.types";

/**
 * Creates and persists a live ACP-backed chat session.
 *
 * Ordering contract: project/agent resolution happens before process spawn;
 * ACP bootstrap must succeed before persistence; on any bootstrap/persist error
 * the spawned process is terminated before the error is rethrown.
 */
export class CreateSessionService {
  private readonly projectContextResolver: SessionProjectContextResolverService;
  private readonly sessionAgentResolver: SessionAgentResolverService;
  private readonly spawnSessionProcess: SpawnSessionProcessService;
  private readonly bootstrapSessionConnection: BootstrapSessionConnectionService;
  private readonly persistSessionBootstrap: PersistSessionBootstrapService;
  private readonly logger: LoggerPort;
  private readonly eventBus?: EventBusPort;
  private readonly terminateProcess: (
    proc: ChatSession["proc"],
    policy?: ProcessTerminationPolicy
  ) => Promise<unknown>;

  constructor(
    projectContextResolver: SessionProjectContextResolverService,
    sessionAgentResolver: SessionAgentResolverService,
    spawnSessionProcess: SpawnSessionProcessService,
    bootstrapSessionConnection: BootstrapSessionConnectionService,
    persistSessionBootstrap: PersistSessionBootstrapService,
    logger: LoggerPort,
    terminateProcess: (
      proc: ChatSession["proc"],
      policy?: ProcessTerminationPolicy
    ) => Promise<unknown> = terminateProcessGracefully,
    eventBus?: EventBusPort
  ) {
    this.projectContextResolver = projectContextResolver;
    this.sessionAgentResolver = sessionAgentResolver;
    this.spawnSessionProcess = spawnSessionProcess;
    this.bootstrapSessionConnection = bootstrapSessionConnection;
    this.persistSessionBootstrap = persistSessionBootstrap;
    this.logger = logger;
    this.eventBus = eventBus;
    this.terminateProcess = terminateProcess;
  }

  async execute(params: CreateSessionParams): Promise<ChatSession> {
    this.logger.debug("CreateSession params", {
      hasProjectId: Boolean(params.projectId),
      hasProjectRoot: Boolean(params.projectRoot),
      hasChatId: Boolean(params.chatId),
      hasSessionIdToLoad: Boolean(params.sessionIdToLoad),
      hasAgentId: Boolean(params.agentId),
      command: params.command,
      argsCount: params.args?.length ?? 0,
    });

    const chatId = params.chatId ?? crypto.randomUUID();
    const { projectId, projectRoot } =
      await this.projectContextResolver.resolve({
        userId: params.userId,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
      });

    const resolvedAgent =
      params.command !== undefined
        ? {
            command: params.command,
            args: params.args,
            env: params.env,
          }
        : await this.sessionAgentResolver.resolve({
            userId: params.userId,
            projectId,
            agentId: params.agentId,
          });
    const agentCommand = resolvedAgent.command.trim();
    if (agentCommand.trim().length === 0) {
      throw new ValidationError("Agent command is required", {
        module: "session",
        op: "session.lifecycle.create",
        details: {
          chatId,
          agentId: params.agentId,
        },
      });
    }
    const agentArgs =
      resolvedAgent.args ?? (agentCommand === "opencode" ? ["acp"] : []);
    const agentEnv = resolvedAgent.env ?? {};

    this.logger.debug("CreateSession selected agent command", {
      chatId,
      command: agentCommand,
      argsCount: agentArgs.length,
    });

    const proc = this.spawnSessionProcess.execute({
      projectRoot,
      agentCommand,
      agentArgs,
      agentEnv,
    });

    try {
      const { chatSession } = await this.bootstrapSessionConnection.execute({
        chatId,
        projectId,
        projectRoot,
        params,
        proc,
      });

      await this.persistSessionBootstrap.execute({
        chatId,
        projectRoot,
        params,
        chatSession,
        agentCommand,
        agentArgs,
        agentEnv,
      });

      await this.eventBus
        ?.publish({
          type: "local_ade_lifecycle",
          event: "after-agent-session-create",
          userId: params.userId,
          projectRoot,
          ...(projectId ? { projectId } : {}),
          chatId,
          ...(chatSession.sessionId
            ? { agentSessionId: chatSession.sessionId }
            : {}),
        })
        .catch((error) => {
          this.logger.warn("CreateSession lifecycle event publish failed", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return chatSession;
    } catch (error) {
      await this.terminateProcess(proc, {
        forceWindowsTreeTermination: true,
      }).catch(() => undefined);
      throw error;
    }
  }
}
