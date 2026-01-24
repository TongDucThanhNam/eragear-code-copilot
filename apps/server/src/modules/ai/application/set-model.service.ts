/**
 * Set Model Service
 *
 * Changes the active model for a session, enabling different AI model
 * configurations for the agent's responses.
 *
 * @module modules/ai/application/set-model.service
 */

import type { SessionRuntimePort } from "../../../shared/types/ports";

/**
 * Connection interface for the unstable setSessionModel method
 */
interface ConnWithUnstableModel {
  /**
   * Unstable method to set the session model
   * @param params - Parameters containing session ID and model ID
   */
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
}

/**
 * SetModelService
 *
 * Provides functionality to change the agent's active model within a session.
 * Uses the unstable_setSessionModel ACP method.
 *
 * @example
 * ```typescript
 * const service = new SetModelService(sessionRuntime);
 * const result = await service.execute("chat-123", "gpt-4");
 * console.log(result.ok); // true
 * ```
 */
export class SetModelService {
  /** Runtime store for accessing active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a SetModelService with required dependencies
   */
  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Sets the active model for a session
   *
   * @param chatId - The chat session identifier
   * @param modelId - The model identifier to activate
   * @returns Success status object
   * @throws Error if session is not found or not running
   */
  async execute(chatId: string, modelId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    await (
      session.conn as unknown as ConnWithUnstableModel
    ).unstable_setSessionModel({
      sessionId: session.sessionId,
      modelId,
    });

    if (session.models) {
      session.models.currentModelId = modelId;
    }
    return { ok: true };
  }
}
