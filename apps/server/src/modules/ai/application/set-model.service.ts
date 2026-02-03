/**
 * Set Model Service
 *
 * Changes the active model for a session, enabling different AI model
 * configurations for the agent's responses.
 *
 * @module modules/ai/application/set-model.service
 */

import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import {
  getAcpErrorText,
  isMethodNotFound,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";

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
  async execute(chatId: string, modelId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }
    if (!session.models || session.models.availableModels.length === 0) {
      throw new Error("Agent does not support model switching");
    }
    const isAvailableModel = session.models.availableModels.some(
      (model) => model.modelId === modelId
    );
    if (!isAvailableModel) {
      throw new Error("Model is not available for this session");
    }
    if (session.models.currentModelId === modelId) {
      return { ok: true };
    }
    console.log("[Server] setModel requested", {
      chatId,
      modelId,
    });
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
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "error",
      });
      this.sessionRepo.updateStatus(chatId, "stopped");
      if (!session.proc.killed) {
        session.proc.kill();
      }
      this.sessionRuntime.delete(chatId);
    };

    const sendRequest = async () => {
      await (
        session.conn as unknown as ConnWithUnstableModel
      ).unstable_setSessionModel({
        sessionId: session.sessionId ?? "",
        modelId,
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
      console.error("[Server] setModel failed", {
        chatId,
        modelId,
        error: errorText || "Failed to set model",
      });
      if (isMethodNotFound(errorText)) {
        throw new Error("Agent does not support model switching");
      }
      throw new Error(errorText || "Failed to set model");
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
}
