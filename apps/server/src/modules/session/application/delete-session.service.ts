/**
 * Delete Session Service
 *
 * Handles the removal of a session, including terminating any running
 * agent process and cleaning up both runtime and persistent storage.
 *
 * @module modules/session/application/delete-session.service
 */

import type { EventBusPort } from "@/shared/ports/event-bus.port";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
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
  /** Event bus for dashboard refresh notifications */
  private readonly eventBus: EventBusPort;

  /**
   * Creates a DeleteSessionService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    eventBus: EventBusPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.eventBus = eventBus;
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
  async execute(chatId: string): Promise<{ ok: true }> {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      terminateSessionTerminals(session);
      session.proc.kill();
      this.sessionRuntime.delete(chatId);
    }
    await this.sessionRepo.delete(chatId);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "session_deleted",
      chatId,
    });
    return { ok: true };
  }
}
