/**
 * Delete Session Service
 *
 * Handles the removal of a session, including terminating any running
 * agent process and cleaning up both runtime and persistent storage.
 *
 * @module modules/session/application/delete-session.service
 */

import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

/**
 * DeleteSessionService
 *
 * Provides session deletion functionality.
 * Terminates the agent process if running and removes session data
 * from both runtime storage and persistent storage.
 */
export class DeleteSessionService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a DeleteSessionService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Deletes a session by ID
   *
   * If the session is currently active, terminates the agent process
   * and removes it from the runtime store. Always removes from persistent storage.
   *
   * @param chatId - The chat session identifier to delete
   * @returns Success status object
   *
   * @example
   * ```typescript
   * const result = await service.execute("chat-123");
   * if (result.ok) {
   *   console.log("Session deleted successfully");
   * }
   * ```
   */
  execute(chatId: string): { ok: true } {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      session.proc.kill();
      this.sessionRuntime.delete(chatId);
    }
    this.sessionRepo.delete(chatId);
    return { ok: true };
  }
}
