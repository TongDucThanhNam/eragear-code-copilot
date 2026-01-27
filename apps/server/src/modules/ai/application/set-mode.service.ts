/**
 * Set Mode Service
 *
 * Changes the active mode for a session, enabling different behavioral
 * configurations for the AI agent.
 *
 * @module modules/ai/application/set-mode.service
 */

import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";
import {
  getAcpErrorText,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";

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
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;

  /**
   * Creates a SetModeService with required dependencies
   */
  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
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
    const stdin = session.proc.stdin;
    if (
      !stdin ||
      stdin.destroyed ||
      !stdin.writable ||
      session.proc.killed ||
      session.proc.exitCode !== null
    ) {
      throw new Error("Session is not running");
    }
    if (session.conn.signal.aborted) {
      throw new Error("Session connection is closed");
    }

    const markStopped = (reason: string) => {
      this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: reason,
      });
      this.sessionRepo.updateStatus(chatId, "stopped");
      if (!session.proc.killed) {
        session.proc.kill();
      }
      this.sessionRuntime.delete(chatId);
    };

    const sendRequest = async () => {
      await session.conn.setSessionMode({
        sessionId: session.sessionId,
        modeId,
      });
    };

    try {
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await sendRequest();
          break;
        } catch (error) {
          const errorText = getAcpErrorText(error);
          if (
            isProcessTransportNotReady(errorText) &&
            attempt < maxAttempts - 1
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, 150 * (attempt + 1))
            );
            continue;
          }
          if (isProcessExited(errorText)) {
            markStopped(errorText || "Agent process exited");
            throw new Error(errorText || "Agent process exited");
          }
          throw error;
        }
      }
    } catch (error) {
      const errorText = getAcpErrorText(error);
      throw new Error(errorText || "Failed to set mode");
    }

    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    return { ok: true };
  }
}
