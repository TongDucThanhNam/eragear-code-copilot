/**
 * Set Mode Service
 *
 * Changes the active mode for a session, enabling different behavioral
 * configurations for the AI agent.
 *
 * @module modules/ai/application/set-mode.service
 */

import type { SessionRuntimePort } from "../../../shared/types/ports";

/**
 * SetModeService
 *
 * Provides functionality to change the agent's active mode within a session.
 *
 * @example
 * ```typescript
 * const service = new SetModeService(sessionRuntime);
 * const result = await service.execute("chat-123", "code-review");
 * console.log(result.ok); // true
 * ```
 */
export class SetModeService {
  /** Runtime store for accessing active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a SetModeService with required dependencies
   */
  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Sets the active mode for a session
   *
   * @param chatId - The chat session identifier
   * @param modeId - The mode identifier to activate
   * @returns Success status object
   * @throws Error if session is not found or not running
   */
  async execute(chatId: string, modeId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    await session.conn.setSessionMode({
      sessionId: session.sessionId,
      modeId,
    });

    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    return { ok: true };
  }
}
