import crypto from "node:crypto";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionOrchestratorService } from "./session-orchestrator.service";
import type { SessionProjectContextResolverService } from "./session-project-context-resolver.service";

export type { CreateSessionParams } from "./create-session.types";

export class CreateSessionService {
  private readonly projectContextResolver: SessionProjectContextResolverService;
  private readonly sessionOrchestrator: SessionOrchestratorService;
  private readonly logger: LoggerPort;

  constructor(
    projectContextResolver: SessionProjectContextResolverService,
    sessionOrchestrator: SessionOrchestratorService,
    logger: LoggerPort
  ) {
    this.projectContextResolver = projectContextResolver;
    this.sessionOrchestrator = sessionOrchestrator;
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

    return this.sessionOrchestrator.execute({
      chatId,
      projectId,
      projectRoot,
      params,
      agentCommand,
      agentArgs,
      agentEnv,
    });
  }
}
