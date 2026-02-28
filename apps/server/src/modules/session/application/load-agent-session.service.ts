import type { ChatSession } from "@/shared/types/session.types";
import type { CreateSessionService } from "./create-session.service";

export interface LoadAgentSessionInput {
  userId: string;
  projectId: string;
  sessionId: string;
  agentId?: string;
}

export class LoadAgentSessionService {
  private readonly createSession: CreateSessionService;

  constructor(createSession: CreateSessionService) {
    this.createSession = createSession;
  }

  async execute(input: LoadAgentSessionInput): Promise<ChatSession> {
    return await this.createSession.execute({
      userId: input.userId,
      projectId: input.projectId,
      agentId: input.agentId,
      sessionIdToLoad: input.sessionId,
      importExternalHistoryOnLoad: true,
    });
  }
}
