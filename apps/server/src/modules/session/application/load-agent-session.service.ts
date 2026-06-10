import type { ChatSession } from "@/shared/types/session.types";
import type { CreateSessionService } from "./create-session.service";

/**
 * Request to load an agent-native session into a local chat runtime.
 *
 * Invariant: `sessionId` is the external ACP session id, not the local chat id.
 */
export interface LoadAgentSessionInput {
  userId: string;
  projectId: string;
  sessionId: string;
  agentId?: string;
}

/**
 * Thin use case that routes agent-native resume through canonical session creation.
 *
 * Side effect: creates a running local chat session and enables external history
 * import fallback when the agent replay is sparse.
 */
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
