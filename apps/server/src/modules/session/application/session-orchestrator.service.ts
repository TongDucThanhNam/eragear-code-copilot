import type { ChatSession } from "@/shared/types/session.types";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import type { CreateSessionParams } from "./create-session.types";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionAcpBootstrapService } from "./session-acp-bootstrap.service";
import type { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";
import type { SessionProcessLifecycleService } from "./session-process-lifecycle.service";
import type { SessionRuntimeBootstrapService } from "./session-runtime-bootstrap.service";

export interface OrchestrateSessionInput {
  chatId: string;
  projectId?: string;
  projectRoot: string;
  params: CreateSessionParams;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
}

export class SessionOrchestratorService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly agentRuntime: AgentRuntimePort;
  private readonly runtimeBootstrap: SessionRuntimeBootstrapService;
  private readonly acpBootstrap: SessionAcpBootstrapService;
  private readonly processLifecycle: SessionProcessLifecycleService;
  private readonly metadataPersistence: SessionMetadataPersistenceService;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    agentRuntime: AgentRuntimePort,
    runtimeBootstrap: SessionRuntimeBootstrapService,
    acpBootstrap: SessionAcpBootstrapService,
    processLifecycle: SessionProcessLifecycleService,
    metadataPersistence: SessionMetadataPersistenceService
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.agentRuntime = agentRuntime;
    this.runtimeBootstrap = runtimeBootstrap;
    this.acpBootstrap = acpBootstrap;
    this.processLifecycle = processLifecycle;
    this.metadataPersistence = metadataPersistence;
  }

  async execute(input: OrchestrateSessionInput): Promise<ChatSession> {
    const {
      chatId,
      projectId,
      projectRoot,
      params,
      agentCommand,
      agentArgs,
      agentEnv,
    } = input;

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
