import type { ChatSession } from "@/shared/types/session.types";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionAcpBootstrapService } from "./session-acp-bootstrap.service";
import type { SessionProcessLifecycleService } from "./session-process-lifecycle.service";
import type { SessionRuntimeBootstrapService } from "./session-runtime-bootstrap.service";

export interface BootstrapSessionConnectionInput {
  chatId: string;
  projectId?: string;
  projectRoot: string;
  params: CreateSessionParams;
  proc: ChatSession["proc"];
}

export interface BootstrapSessionConnectionOutput {
  chatSession: ChatSession;
}

export class BootstrapSessionConnectionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly runtimeBootstrap: SessionRuntimeBootstrapService;
  private readonly acpBootstrap: SessionAcpBootstrapService;
  private readonly processLifecycle: SessionProcessLifecycleService;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    runtimeBootstrap: SessionRuntimeBootstrapService,
    acpBootstrap: SessionAcpBootstrapService,
    processLifecycle: SessionProcessLifecycleService
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.runtimeBootstrap = runtimeBootstrap;
    this.acpBootstrap = acpBootstrap;
    this.processLifecycle = processLifecycle;
  }

  async execute(
    input: BootstrapSessionConnectionInput
  ): Promise<BootstrapSessionConnectionOutput> {
    const { chatId, projectId, projectRoot, params, proc } = input;

    let chatSession: ChatSession | undefined;

    try {
      const storedSession = params.chatId
        ? await this.sessionRepo.findById(chatId, params.userId)
        : undefined;

      const prepared = await this.runtimeBootstrap.prepare({
        chatId,
        userId: params.userId,
        proc,
        projectId,
        projectRoot,
        sessionIdToLoad: params.sessionIdToLoad,
        plan: storedSession?.plan,
      });
      chatSession = prepared.chatSession;

      await this.acpBootstrap.bootstrap({
        chatId,
        chatSession,
        buffer: prepared.buffer,
        projectRoot,
        sessionIdToLoad: params.sessionIdToLoad,
      });

      await updateChatStatus({
        chatId,
        session: chatSession,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "ready",
      });

      this.processLifecycle.attach(proc, chatId);

      return { chatSession };
    } catch (error) {
      if (chatSession) {
        this.sessionRuntime.deleteIfMatch(chatId, chatSession);
      }
      await terminateProcessGracefully(proc, {
        forceWindowsTreeTermination: true,
      }).catch(() => undefined);
      throw error;
    }
  }
}
