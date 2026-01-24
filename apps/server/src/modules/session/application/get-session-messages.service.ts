/**
 * Get Session Messages Service
 *
 * Retrieves the message history for a specific session from persistent storage.
 *
 * @module modules/session/application/get-session-messages.service
 */

import type { SessionRepositoryPort } from "../../../shared/types/ports";

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
  execute(chatId: string) {
    return this.sessionRepo.getMessages(chatId);
  }
}
