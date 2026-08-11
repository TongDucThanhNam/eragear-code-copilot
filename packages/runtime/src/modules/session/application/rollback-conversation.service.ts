import path from "node:path";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type {
  ChatSession,
  StoredMessage,
} from "#runtime/shared/types/session.types";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.conversation.rollback";

interface StopSessionPort {
  execute(userId: string, chatId: string): Promise<{ ok: true }>;
}

interface CreateSessionPort {
  execute(params: CreateSessionParams): Promise<ChatSession>;
}

export interface RollbackConversationInput {
  userId: string;
  sessionId: string;
  projectRoot: string;
  turnCount: number;
}

export class RollbackConversationService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly stopSession: StopSessionPort;
  private readonly createSession: CreateSessionPort;
  private readonly sessionRuntime: Pick<SessionRuntimePort, "broadcast">;

  constructor(
    sessionRepo: SessionRepositoryPort,
    stopSession: StopSessionPort,
    createSession: CreateSessionPort,
    sessionRuntime: Pick<SessionRuntimePort, "broadcast">
  ) {
    this.sessionRepo = sessionRepo;
    this.stopSession = stopSession;
    this.createSession = createSession;
    this.sessionRuntime = sessionRuntime;
  }

  async resolveProjectRoot(input: {
    userId: string;
    sessionId: string;
    projectId?: string;
  }): Promise<string> {
    const stored = await this.sessionRepo.findById(
      input.sessionId,
      input.userId
    );
    if (!stored) {
      throw new NotFoundError("Session not found for Git root resolution", {
        module: "session",
        op: OP,
        details: { sessionId: input.sessionId },
      });
    }
    if (input.projectId && stored.projectId !== input.projectId) {
      throw new ValidationError("Session project ownership mismatch", {
        module: "session",
        op: OP,
        details: { sessionId: input.sessionId, projectId: input.projectId },
      });
    }
    return stored.projectRoot;
  }

  async execute(
    input: RollbackConversationInput
  ): Promise<{ replayedMessages: number }> {
    const stored = await this.sessionRepo.findById(
      input.sessionId,
      input.userId
    );
    if (!stored) {
      throw new NotFoundError("Session not found for conversation rollback", {
        module: "session",
        op: OP,
        details: { sessionId: input.sessionId },
      });
    }
    if (path.resolve(stored.projectRoot) !== path.resolve(input.projectRoot)) {
      throw new ValidationError("Conversation rollback project root mismatch", {
        module: "session",
        op: OP,
        details: { sessionId: input.sessionId },
      });
    }

    const retainedMessages = truncateMessagesToTurn(
      stored.messages,
      input.turnCount
    );
    await this.stopSession.execute(input.userId, input.sessionId);
    await this.sessionRepo.replaceMessages(
      input.sessionId,
      input.userId,
      retainedMessages
    );
    await this.sessionRepo.updateMetadata(input.sessionId, input.userId, {
      sessionId: undefined,
      status: "stopped",
    });
    await this.createSession.execute({
      userId: input.userId,
      ...(stored.projectId ? { projectId: stored.projectId } : {}),
      projectRoot: stored.projectRoot,
      ...(stored.envMode === "worktree"
        ? { trustedProjectRoot: stored.projectRoot }
        : {}),
      envMode: stored.envMode ?? "local",
      ...(stored.worktreePath ? { worktreePath: stored.worktreePath } : {}),
      ...(stored.worktreeBranch
        ? { worktreeBranch: stored.worktreeBranch }
        : {}),
      ...(stored.agentId ? { agentId: stored.agentId } : {}),
      ...(stored.command ? { command: stored.command } : {}),
      ...(stored.args ? { args: stored.args } : {}),
      ...(stored.env ? { env: stored.env } : {}),
      chatId: stored.id,
      importExternalHistoryOnLoad: false,
    });
    await this.sessionRuntime.broadcast(input.sessionId, {
      type: "session_reverted",
      turnCount: input.turnCount,
      replayedMessages: retainedMessages.length,
    });
    return { replayedMessages: retainedMessages.length };
  }
}

export function truncateMessagesToTurn(
  messages: StoredMessage[],
  turnCount: number
): StoredMessage[] {
  if (!Number.isInteger(turnCount) || turnCount < 0) {
    throw new ValidationError("Conversation turn count is invalid", {
      module: "session",
      op: OP,
      details: { turnCount },
    });
  }
  const availableTurns = messages.reduce(
    (count, message) => count + (message.role === "user" ? 1 : 0),
    0
  );
  if (turnCount > availableTurns) {
    throw new ValidationError("Conversation turn checkpoint is out of range", {
      module: "session",
      op: OP,
      details: { turnCount, availableTurns },
    });
  }
  if (turnCount === availableTurns) {
    return [...messages];
  }

  let seenTurns = 0;
  const retained: StoredMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      if (seenTurns >= turnCount) {
        break;
      }
      seenTurns += 1;
    }
    retained.push(message);
  }
  return retained;
}
