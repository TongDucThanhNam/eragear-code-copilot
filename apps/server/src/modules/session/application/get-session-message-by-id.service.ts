/**
 * Get Session Message By ID Service
 *
 * Retrieves a single message for a specific session.
 *
 * @module modules/session/application/get-session-message-by-id.service
 */

import type { SessionRepositoryPort } from "./ports/session-repository.port";
import { SessionQueries } from "./queries/session-queries";

/**
 * Compatibility wrapper for single-message reads.
 *
 * Caller contract: new transport/bootstrap code should use
 * `SessionQueries.messageById`; this class remains for direct service tests and
 * older application imports.
 */
export class GetSessionMessageByIdService {
  private readonly queries: SessionQueries;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.queries = new SessionQueries(sessionRepo);
  }

  async execute(input: { userId: string; chatId: string; messageId: string }) {
    return await this.queries.messageById(input);
  }
}
