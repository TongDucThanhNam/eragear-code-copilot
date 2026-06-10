/**
 * Get Session Messages Service
 *
 * Retrieves paginated message history for a specific session.
 *
 * @module modules/session/application/get-session-messages.service
 */

import type { SessionRepositoryPort } from "./ports/session-repository.port";
import { SessionQueries } from "./queries/session-queries";

/**
 * GetSessionMessagesService
 *
 * Compatibility wrapper for paginated message history reads.
 *
 * Caller contract: new primary-path callers should use
 * `SessionQueries.messages`; this class delegates to keep legacy tests/imports
 * on the same canonical implementation.
 */
export class GetSessionMessagesService {
  private readonly queries: SessionQueries;

  /**
   * Creates a GetSessionMessagesService with required dependencies
   */
  constructor(sessionRepo: SessionRepositoryPort) {
    this.queries = new SessionQueries(sessionRepo);
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
    return await this.queries.messages(input);
  }
}
