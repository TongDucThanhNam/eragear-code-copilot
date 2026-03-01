import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import type { SessionBufferingPort } from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionMessageMapper } from "./session-message.mapper";

const STORED_REPLAY_PAGE_LIMIT = 200;

export class SessionHistoryReplayService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly messageMapper: SessionMessageMapper;
  private readonly logger: LoggerPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    messageMapper: SessionMessageMapper,
    logger: LoggerPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.messageMapper = messageMapper;
    this.logger = logger;
  }

  async broadcastPromptEnd(
    chatId: string,
    buffer: SessionBufferingPort
  ): Promise<void> {
    const session = this.sessionRuntime.get(chatId);
    const shouldReplayStored =
      buffer.replayEventCount === 0 && !session?.suppressReplayBroadcast;
    if (session) {
      session.replayedStoredHistoryFallback = shouldReplayStored;
    }
    this.logger.debug("History replay decision", {
      chatId,
      replayEventCount: buffer.replayEventCount,
      suppressReplayBroadcast: Boolean(session?.suppressReplayBroadcast),
      shouldReplayStored,
    });

    if (shouldReplayStored) {
      await this.replayStoredMessages(chatId, session?.userId);
    }

    const currentMessageId = session?.uiState.currentAssistantId;
    if (!(session && currentMessageId)) {
      return;
    }

    const message = session.uiState.messages.get(currentMessageId);
    if (message) {
      const finalizedMessage = finalizeStreamingParts(message);
      if (finalizedMessage !== message) {
        session.uiState.messages.set(finalizedMessage.id, finalizedMessage);
      }
      await this.sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: finalizedMessage,
      });
    }
    session.uiState.currentAssistantId = undefined;
  }

  private async replayStoredMessages(
    chatId: string,
    userId?: string
  ): Promise<void> {
    if (!userId) {
      return;
    }
    const storedMessages: StoredMessage[] = [];
    let cursor: number | undefined;

    while (true) {
      const page = await this.sessionRepo.getMessagesPage(chatId, userId, {
        cursor,
        limit: STORED_REPLAY_PAGE_LIMIT,
        includeCompacted: true,
      });
      storedMessages.push(...page.messages);
      if (!page.hasMore || page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    if (storedMessages.length === 0) {
      this.logger.warn("Agent did not replay history and no stored messages", {
        chatId,
      });
      return;
    }

    this.logger.warn(
      "Agent did not replay history; replaying stored messages",
      {
        chatId,
        replayCount: storedMessages.length,
      }
    );
    for (const message of storedMessages) {
      await this.messageMapper.broadcastStoredMessage(chatId, message);
    }
  }
}
