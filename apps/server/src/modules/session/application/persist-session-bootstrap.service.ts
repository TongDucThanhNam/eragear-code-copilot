import type { ChatSession } from "@/shared/types/session.types";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";

export interface PersistSessionBootstrapInput {
  chatId: string;
  projectRoot: string;
  params: CreateSessionParams;
  chatSession: ChatSession;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
}

export class PersistSessionBootstrapService {
  private readonly metadataPersistence: SessionMetadataPersistenceService;

  constructor(metadataPersistence: SessionMetadataPersistenceService) {
    this.metadataPersistence = metadataPersistence;
  }

  async execute(input: PersistSessionBootstrapInput): Promise<void> {
    await this.metadataPersistence.persist({
      chatId: input.chatId,
      params: input.params,
      chatSession: input.chatSession,
      agentCommand: input.agentCommand,
      agentArgs: input.agentArgs,
      agentEnv: input.agentEnv,
      projectRoot: input.projectRoot,
    });
  }
}
