import crypto from "node:crypto";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import type { CreateSessionParams } from "./create-session.types";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionAcpBootstrapService } from "./session-acp-bootstrap.service";
import type { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";
import type { SessionProcessLifecycleService } from "./session-process-lifecycle.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";
import type { SessionRuntimeBootstrapService } from "./session-runtime-bootstrap.service";

export type { CreateSessionParams } from "./create-session.types";

export class CreateSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly agentRuntime: AgentRuntimePort;
  private readonly projectContextResolver: SessionProjectContextResolverService;
  private readonly runtimeBootstrap: SessionRuntimeBootstrapService;
  private readonly acpBootstrap: SessionAcpBootstrapService;
  private readonly processLifecycle: SessionProcessLifecycleService;
  private readonly metadataPersistence: SessionMetadataPersistenceService;
  private readonly logger: LoggerPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    agentRuntime: AgentRuntimePort,
    projectContextResolver: SessionProjectContextResolverService,
    runtimeBootstrap: SessionRuntimeBootstrapService,
    acpBootstrap: SessionAcpBootstrapService,
    processLifecycle: SessionProcessLifecycleService,
    metadataPersistence: SessionMetadataPersistenceService,
    logger: LoggerPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.agentRuntime = agentRuntime;
    this.projectContextResolver = projectContextResolver;
    this.runtimeBootstrap = runtimeBootstrap;
    this.acpBootstrap = acpBootstrap;
    this.processLifecycle = processLifecycle;
    this.metadataPersistence = metadataPersistence;
    this.logger = logger;
  }

  async execute(params: CreateSessionParams): Promise<ChatSession> {
    this.logger.debug("CreateSession params", {
      hasProjectId: Boolean(params.projectId),
      hasProjectRoot: Boolean(params.projectRoot),
      hasChatId: Boolean(params.chatId),
      hasSessionIdToLoad: Boolean(params.sessionIdToLoad),
      command: params.command,
      argsCount: params.args?.length ?? 0,
    });

    const chatId = params.chatId ?? crypto.randomUUID();
    const agentCommand = params.command ?? "opencode";
    const agentArgs =
      params.args ?? (agentCommand === "opencode" ? ["acp"] : []);
    const agentEnv = params.env ?? {};

    const { projectId, projectRoot } =
      await this.projectContextResolver.resolve({
        userId: params.userId,
        projectId: params.projectId,
        projectRoot: params.projectRoot,
      });

    this.logger.debug("CreateSession selected agent command", {
      chatId,
      command: agentCommand,
      argsCount: agentArgs.length,
    });

    const proc = this.agentRuntime.spawn(agentCommand, agentArgs, {
      cwd: projectRoot,
      env: agentEnv,
    });

    const storedSession = params.chatId
      ? await this.sessionRepo.findById(chatId, params.userId)
      : undefined;
    const { chatSession, buffer } = await this.runtimeBootstrap.prepare({
      chatId,
      userId: params.userId,
      proc,
      projectId,
      projectRoot,
      sessionIdToLoad: params.sessionIdToLoad,
      plan: storedSession?.plan,
    });

    await this.acpBootstrap.bootstrap({
      chatId,
      chatSession,
      buffer,
      projectRoot,
      sessionIdToLoad: params.sessionIdToLoad,
    });

    updateChatStatus({
      chatId,
      session: chatSession,
      broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
      status: "ready",
    });

    this.processLifecycle.attach(proc, chatId);
    await this.metadataPersistence.persist({
      chatId,
      params,
      chatSession,
      agentCommand,
      agentArgs,
      agentEnv,
      projectRoot,
    });

    return chatSession;
  }
}
