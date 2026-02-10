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
  classifyAcpError,
  getAcpErrorText,
  isMethodNotFound,
} from "./acp-error.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import {
  AI_OP,
  DEFAULT_AI_ACP_RETRY_POLICY,
  HTTP_STATUS,
} from "./ai.constants";

const OP = AI_OP.SESSION_MODE_SET;

interface ModeSwitchPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

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
  private readonly policy: ModeSwitchPolicy;

  /**
   * Creates a SetModeService with required dependencies
   */
  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort,
    policy: ModeSwitchPolicy = {
      acpRetryMaxAttempts: DEFAULT_AI_ACP_RETRY_POLICY.maxAttempts,
      acpRetryBaseDelayMs: DEFAULT_AI_ACP_RETRY_POLICY.retryBaseDelayMs,
    }
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
    this.policy = {
      acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
      acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
    };
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
        statusCode: HTTP_STATUS.BAD_GATEWAY,
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
        statusCode: HTTP_STATUS.CONFLICT,
        module: "ai",
        op: OP,
        details: { chatId, modeId },
      });
    }
    if (session.conn.signal.aborted) {
      throw new AppError({
        message: "Session connection is closed",
        code: "SESSION_CONNECTION_CLOSED",
        statusCode: HTTP_STATUS.CONFLICT,
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
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await session.conn.setSessionMode({
          sessionId: session.sessionId ?? "",
          modeId,
        });
        return;
      } catch (error) {
        const classified = classifyAcpError(error);
        const errorText = classified.text;
        if (
          classified.kind === "retryable_transport" &&
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

        if (
          classified.kind === "fatal_process" ||
          classified.kind === "fatal_session"
        ) {
          const reason =
            errorText ||
            (classified.kind === "fatal_process"
              ? "Agent process exited"
              : "Agent session is unavailable");
          await this.markSessionStopped(
            chatId,
            session,
            reason,
            classified.kind === "fatal_process"
          );
          throw new AppError({
            message: reason,
            code:
              classified.kind === "fatal_process"
                ? "AGENT_PROCESS_EXITED"
                : "SESSION_CONNECTION_CLOSED",
            statusCode:
              classified.kind === "fatal_process"
                ? HTTP_STATUS.SERVICE_UNAVAILABLE
                : HTTP_STATUS.CONFLICT,
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
    reason: string,
    killProcess: boolean
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
    if (killProcess && !session.proc.killed) {
      session.proc.kill();
    }
    this.sessionRuntime.delete(chatId);
  }
}
