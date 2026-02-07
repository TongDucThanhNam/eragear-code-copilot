/**
 * Get Session Messages Service
 *
 * Retrieves the message history for a specific session from persistent storage.
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
   * Retrieves all messages for a session
   *
   * @param chatId - The chat session identifier
   * @returns Array of stored messages in chronological order
   *
   * @example
   * ```typescript
   * const messages = service.execute("chat-123");
   * messages.forEach(msg => console.log(msg.role, msg.content));
   * ```
   */
  async execute(chatId: string) {
    const stored = await this.sessionRepo.getMessages(chatId);
    return stored.map((message) => {
      if (message.parts && message.parts.length > 0) {
        return {
          id: message.id,
          role: message.role,
          parts: message.parts,
        };
      }
      const contentBlocks =
        message.contentBlocks ??
        (message.content ? [{ type: "text", text: message.content }] : []);
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
  }
}
