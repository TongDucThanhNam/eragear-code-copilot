/**
 * Get Session Messages Service
 *
 * Retrieves paginated message history for a specific session.
 *
 * @module modules/session/application/get-session-messages.service
 */

import {
  buildAssistantMessageFromBlocks,
  buildUserMessageFromBlocks,
} from "@/shared/utils/ui-message.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

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
    chatId: string;
    cursor?: number;
    limit?: number;
    includeCompacted?: boolean;
  }) {
    const page = await this.sessionRepo.getMessagesPage(input.chatId, {
      cursor: input.cursor,
      limit: input.limit,
      includeCompacted: input.includeCompacted,
    });

    const messages = page.messages.map((message) => {
      if (message.parts && message.parts.length > 0) {
        return {
          id: message.id,
          role: message.role,
          parts: message.parts,
        };
      }
      const compactedText =
        message.role === "assistant"
          ? "[Assistant message compacted for local retention]"
          : "[User message compacted for local retention]";
      let contentBlocks = message.contentBlocks;
      if (!contentBlocks) {
        if (message.content) {
          contentBlocks = [{ type: "text", text: message.content }];
        } else if (message.isCompacted) {
          contentBlocks = [{ type: "text", text: compactedText }];
        } else {
          contentBlocks = [];
        }
      }
      const reasoningBlocks =
        message.reasoningBlocks ??
        (message.reasoning ? [{ type: "text", text: message.reasoning }] : []);
      if (message.role === "user") {
        return buildUserMessageFromBlocks({
          messageId: message.id,
          contentBlocks,
        });
      }
      return buildAssistantMessageFromBlocks({
        messageId: message.id,
        contentBlocks,
        reasoningBlocks,
      });
    });

    return {
      messages,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }
}
