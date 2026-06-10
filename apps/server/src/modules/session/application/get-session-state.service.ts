/**
 * Get Session State Service
 *
 * Retrieves the current state of a session from either the runtime store
 * (for active sessions) or persistent storage (for stopped sessions).
 *
 * @module modules/session/application/get-session-state.service
 */

import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionQueries } from "./queries/session-queries";

/**
 * GetSessionStateService
 *
 * Compatibility wrapper for session state reads.
 *
 * Caller contract: `SessionQueries.state` is the canonical read surface; this
 * class delegates so legacy direct imports observe the same runtime-first,
 * persisted-fallback behavior.
 */
export class GetSessionStateService {
  private readonly queries: SessionQueries;

  /**
   * Creates a GetSessionStateService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    supervisorEnabled?: boolean
  ) {
    this.queries = new SessionQueries(
      sessionRepo,
      sessionRuntime,
      undefined,
      supervisorEnabled
    );
  }

  /**
   * Retrieves the current state of a session
   *
   * @param chatId - The chat session identifier
   * @returns Session state object containing status, modes, models, and capabilities
   * @throws Error if the session is not found
   *
   * @example
   * ```typescript
   * const state = service.execute("chat-123");
   * console.log(state.status); // "running" or "stopped"
   * console.log(state.modes); // Available modes if running
   * ```
   */
  async execute(userId: string, chatId: string) {
    return await this.queries.state(userId, chatId);
  }
}
