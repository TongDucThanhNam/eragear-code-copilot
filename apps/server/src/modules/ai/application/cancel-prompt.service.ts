/**
 * Cancel Prompt Service
 *
 * Cancels an ongoing prompt execution in a session and resolves any pending
 * permission requests with a cancelled outcome.
 *
 * @module modules/ai/application/cancel-prompt.service
 */

import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { updateChatStatus } from "@/shared/utils/chat-events.util";

/**
 * CancelPromptService
 *
 * Provides functionality to cancel an ongoing agent prompt.
 * Cancels the ACP prompt request and resolves all pending permission
 * requests with a "cancelled" outcome.
 *
 * @example
 * ```typescript
 * const service = new CancelPromptService(sessionRuntime);
 * const result = await service.execute("chat-123");
 * console.log(result.ok); // true
 * ```
 */
export class CancelPromptService {
  /** Runtime store for accessing active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a CancelPromptService with required dependencies
   */
  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Cancels the ongoing prompt in a session
   *
   * @param chatId - The chat session identifier
   * @returns Success status object
   * @throws Error if session is not found or not running
   */
  async execute(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    updateChatStatus({
      chatId,
      session,
      broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
      status: "cancelling",
    });

    await session.conn.cancel({ sessionId: session.sessionId });
    for (const [, pending] of session.pendingPermissions) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    return { ok: true };
  }
}
