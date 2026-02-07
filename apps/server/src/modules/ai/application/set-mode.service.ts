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
} from "@/modules/session";
import { AppError, NotFoundError, ValidationError } from "@/shared/errors";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import {
  getAcpErrorText,
  isMethodNotFound,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";

const OP = "ai.session.mode.set";

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
      throw new NotFoundError("Chat not found", {
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }
    // Check if agent supports mode switching
    if (!session.modes || session.modes.availableModes.length === 0) {
      throw new ValidationError("Agent does not support mode switching", {
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }
    // Check if the requested mode is available
    const isAvailableMode = session.modes.availableModes.some(
      (mode) => mode.id === modeId
    );
    if (!isAvailableMode) {
      throw new ValidationError("Mode is not available for this session", {
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }
    // Skip if already on this mode
    if (session.modes.currentModeId === modeId) {
      return { ok: true };
    }
    const stdin = session.proc.stdin;
    if (
      !stdin ||
      stdin.destroyed ||
      !stdin.writable ||
      session.proc.killed ||
      session.proc.exitCode !== null
    ) {
      throw new AppError({
        message: "Session is not running",
        code: "SESSION_NOT_RUNNING",
        statusCode: 409,
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }
    if (session.conn.signal.aborted) {
      throw new AppError({
        message: "Session connection is closed",
        code: "SESSION_CONNECTION_CLOSED",
        statusCode: 409,
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }

    const markStopped = async (reason: string) => {
      this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: reason,
      });
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "error",
      });
      await this.sessionRepo.updateStatus(chatId, "stopped");
      if (!session.proc.killed) {
        session.proc.kill();
      }
      this.sessionRuntime.delete(chatId);
    };

    const sendRequest = async () => {
      await session.conn.setSessionMode({
        sessionId: session.sessionId ?? "",
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
            await markStopped(errorText || "Agent process exited");
            throw new AppError({
              message: errorText || "Agent process exited",
              code: "AGENT_PROCESS_EXITED",
              statusCode: 503,
              module: "ai",
              op: OP,
              details: { chatId, modeId },
            });
          }
          throw error;
        }
      }
    } catch (error) {
      const errorText = getAcpErrorText(error);
      if (isMethodNotFound(errorText)) {
        throw new ValidationError("Agent does not support mode switching", {
          module: "ai",
          op: OP,
          details: { chatId, modeId },
        });
      }
      throw new AppError({
        message: errorText || "Failed to set mode",
        code: "SET_MODE_FAILED",
        statusCode: 502,
        module: "ai",
        op: OP,
        cause: error,
        details: { chatId, modeId },
      });
    }

    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    return { ok: true };
  }
}
