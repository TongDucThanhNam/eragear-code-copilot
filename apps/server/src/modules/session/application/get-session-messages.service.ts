/**
 * Get Session Messages Service
 *
 * Retrieves paginated message history for a specific session.
 *
 * @module modules/session/application/get-session-messages.service
 */

import type { UIMessage } from "@repo/shared";
import { DEFAULT_SESSION_MESSAGES_PAGE_LIMIT } from "@/config/constants";
import { NotFoundError, ValidationError } from "@/shared/errors";
import {
  buildAssistantMessageFromBlocks,
  buildUserMessageFromBlocks,
} from "@/shared/utils/ui-message.util";
import type { StoredMessage } from "../domain/stored-session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

const OP = "session.messages.get";
const USER_COMPACTED_TEXT = "[User message compacted for local retention]";
const ASSISTANT_COMPACTED_TEXT =
  "[Assistant message compacted for local retention]";

export function mapStoredMessageToUiMessage(message: StoredMessage): UIMessage {
  if (message.parts && message.parts.length > 0) {
    return {
      id: message.id,
      role: message.role,
      createdAt: message.timestamp,
      parts: message.parts,
    };
  }

  let contentBlocks: ContentBlock[];
  if (message.contentBlocks) {
    contentBlocks = message.contentBlocks;
  } else if (message.content) {
    contentBlocks = [{ type: "text", text: message.content }];
  } else if (message.isCompacted) {
    contentBlocks = [
      {
        type: "text",
        text:
          message.role === "assistant"
            ? ASSISTANT_COMPACTED_TEXT
            : USER_COMPACTED_TEXT,
      },
    ];
  } else {
    contentBlocks = [];
  }
  const reasoningBlocks =
    message.reasoningBlocks ??
    (message.reasoning ? [{ type: "text", text: message.reasoning }] : []);

  if (message.role === "user") {
    return buildUserMessageFromBlocks({
      messageId: message.id,
      contentBlocks,
      createdAt: message.timestamp,
    });
  }
  return buildAssistantMessageFromBlocks({
    messageId: message.id,
    contentBlocks,
    reasoningBlocks,
    createdAt: message.timestamp,
  });
}

/**
 * GetSessionMessagesService
 *
 * Provides read-only access to session message history.
 */
export class GetSessionMessagesService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;

  /**
   * Creates a GetSessionMessagesService with required dependencies
   */
  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  /**
   * Retrieves paginated messages for a session
   *
   * @returns Paginated messages in chronological order
   */
  async execute(input: {
    userId: string;
    chatId: string;
    cursor?: number;
    direction?: "forward" | "backward";
    limit?: number;
    maxLimit: number;
    includeCompacted?: boolean;
  }) {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId: input.chatId },
      });
    }
    const normalizedMaxLimit = Math.max(1, Math.trunc(input.maxLimit));
    if (
      input.limit !== undefined &&
      Number.isFinite(input.limit) &&
      input.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: OP,
        details: {
          chatId: input.chatId,
          limit: input.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    const page = await this.sessionRepo.getMessagesPage(
      input.chatId,
      input.userId,
      {
        cursor: input.cursor,
        direction: input.direction,
        limit:
          input.limit ??
          Math.min(DEFAULT_SESSION_MESSAGES_PAGE_LIMIT, normalizedMaxLimit),
        includeCompacted: input.includeCompacted,
      }
    );

    const messages = page.messages.map((message) =>
      mapStoredMessageToUiMessage(message)
    );

    return {
      messages,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }
}
