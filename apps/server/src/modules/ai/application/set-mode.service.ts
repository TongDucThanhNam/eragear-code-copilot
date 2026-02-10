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
import type { ChatSession } from "@/shared/types/session.types";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import {
  getAcpErrorText,
  isMethodNotFound,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";

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
  async execute(userId: string, chatId: string, modeId: string) {
    const session = this.getSessionForModeSwitch(userId, chatId, modeId);

    if (session.modes?.currentModeId === modeId) {
      return { ok: true };
    }

    this.ensureSessionRunning(session, chatId, modeId);

    try {
      await this.sendModeSwitchWithRetry(chatId, modeId, session);
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

  private getSessionForModeSwitch(
    userId: string,
    chatId: string,
    modeId: string
  ): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId || session.userId !== userId) {
      throw new NotFoundError("Chat not found", {
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }

    if (!session.modes || session.modes.availableModes.length === 0) {
      throw new ValidationError("Agent does not support mode switching", {
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }

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

    return session;
  }

  private ensureSessionRunning(
    session: ChatSession,
    chatId: string,
    modeId: string
  ): void {
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
  }

  private async sendModeSwitchWithRetry(
    chatId: string,
    modeId: string,
    session: ChatSession
  ): Promise<void> {
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await session.conn.setSessionMode({
          sessionId: session.sessionId ?? "",
          modeId,
        });
        return;
      } catch (error) {
        const errorText = getAcpErrorText(error);
        if (
          isProcessTransportNotReady(errorText) &&
          attempt < maxAttempts - 1
        ) {
          await new Promise((resolve) => {
            setTimeout(
              resolve,
              getAcpRetryDelayMs(attempt + 1, retryBaseDelayMs)
            );
          });
          continue;
        }

        if (isProcessExited(errorText)) {
          const reason = errorText || "Agent process exited";
          await this.markSessionStopped(chatId, session, reason);
          throw new AppError({
            message: reason,
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
  }

  private async markSessionStopped(
    chatId: string,
    session: ChatSession,
    reason: string
  ): Promise<void> {
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
    await this.sessionRepo.updateStatus(chatId, session.userId, "stopped");
    if (!session.proc.killed) {
      session.proc.kill();
    }
    this.sessionRuntime.delete(chatId);
  }
}
