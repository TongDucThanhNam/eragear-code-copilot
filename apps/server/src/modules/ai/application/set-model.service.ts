/**
 * Set Model Service
 *
 * Changes the active model for a session, enabling different AI model
 * configurations for the agent's responses.
 *
 * @module modules/ai/application/set-model.service
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

const OP = "ai.session.model.set";

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
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;

  /**
   * Creates a SetModelService with required dependencies
   */
  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
  }

  /**
   * Sets the active model for a session
   *
   * @param chatId - The chat session identifier
   * @param modelId - The model identifier to activate
   * @returns Success status object
   * @throws Error if session is not found or not running
   */
  async execute(userId: string, chatId: string, modelId: string) {
    const session = this.getSessionForModelSwitch(userId, chatId);
    if (this.isCurrentModel(session, modelId)) {
      return { ok: true };
    }

    console.log("[Server] setModel requested", {
      chatId,
      modelId,
    });
    this.ensureSessionRunning(session);

    try {
      await this.sendModelSwitchWithRetry(chatId, session, modelId);
    } catch (error) {
      const errorText = getAcpErrorText(error);
      console.error("[Server] setModel failed", {
        chatId,
        modelId,
        error: errorText || "Failed to set model",
      });
      if (isMethodNotFound(errorText)) {
        throw new ValidationError("Agent does not support model switching", {
          module: "ai",
          op: OP,
          details: { chatId, modelId },
        });
      }
      throw new AppError({
        message: errorText || "Failed to set model",
        code: "SET_MODEL_FAILED",
        statusCode: 502,
        module: "ai",
        op: OP,
        cause: error,
        details: { chatId, modelId },
      });
    }

    if (session.models) {
      session.models.currentModelId = modelId;
    }
    console.log("[Server] setModel succeeded", {
      chatId,
      modelId,
    });
    return { ok: true };
  }

  private getSessionForModelSwitch(userId: string, chatId: string): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId || session.userId !== userId) {
      throw new NotFoundError("Chat not found", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    if (!session.models || session.models.availableModels.length === 0) {
      throw new ValidationError("Agent does not support model switching", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    return session;
  }

  private isCurrentModel(session: ChatSession, modelId: string) {
    const isAvailableModel = session.models?.availableModels.some(
      (model) => model.modelId === modelId
    );
    if (!isAvailableModel) {
      throw new ValidationError("Model is not available for this session", {
        module: "ai",
        op: OP,
        details: { chatId: session.id, modelId },
      });
    }
    return session.models?.currentModelId === modelId;
  }

  private ensureSessionRunning(session: ChatSession) {
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
        details: { chatId: session.id },
      });
    }
    if (session.conn.signal.aborted) {
      throw new AppError({
        message: "Session connection is closed",
        code: "SESSION_CONNECTION_CLOSED",
        statusCode: 409,
        module: "ai",
        op: OP,
        details: { chatId: session.id },
      });
    }
  }

  private async sendModelSwitchWithRetry(
    chatId: string,
    session: ChatSession,
    modelId: string
  ) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.sendModelSwitchRequest(session, modelId);
        return;
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
          const reason = errorText || "Agent process exited";
          await this.markSessionStopped(chatId, session, reason);
          throw new AppError({
            message: reason,
            code: "AGENT_PROCESS_EXITED",
            statusCode: 503,
            module: "ai",
            op: OP,
            details: { chatId, modelId },
          });
        }
        throw error;
      }
    }
  }

  private async sendModelSwitchRequest(session: ChatSession, modelId: string) {
    await (
      session.conn as unknown as ConnWithUnstableModel
    ).unstable_setSessionModel({
      sessionId: session.sessionId ?? "",
      modelId,
    });
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
