/**
 * Set Model Service
 *
 * Changes the active model for a session, enabling different AI model
 * configurations for the agent's responses.
 *
 * @module modules/ai/application/set-model.service
 */

import { AppError, ValidationError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import {
  AI_OP,
  DEFAULT_AI_ACP_RETRY_POLICY,
  HTTP_STATUS,
} from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";

const OP = AI_OP.SESSION_MODEL_SET;

interface ModelSwitchPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

export class SetModelService {
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly policy: ModelSwitchPolicy;

  constructor(
    sessionGateway: AiSessionRuntimePort,
    policy: ModelSwitchPolicy = {
      acpRetryMaxAttempts: DEFAULT_AI_ACP_RETRY_POLICY.maxAttempts,
      acpRetryBaseDelayMs: DEFAULT_AI_ACP_RETRY_POLICY.retryBaseDelayMs,
    }
  ) {
    this.sessionGateway = sessionGateway;
    this.policy = {
      acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
      acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
    };
  }

  async execute(userId: string, chatId: string, modelId: string) {
    const aggregate = this.getRuntimeForModelSwitch(userId, chatId);
    const session = aggregate.raw;
    if (this.isCurrentModel(session, modelId)) {
      return { ok: true };
    }

    this.sessionGateway.assertSessionRunning({
      chatId,
      session,
      module: "ai",
      op: OP,
      details: { modelId },
    });

    await this.sendModelSwitchWithRetry(chatId, session, modelId);

    aggregate.setCurrentModel(modelId);
    return { ok: true };
  }

  private getRuntimeForModelSwitch(userId: string, chatId: string) {
    const aggregate = this.sessionGateway.requireAuthorizedRuntime({
      userId,
      chatId,
      module: "ai",
      op: OP,
    });
    const session = aggregate.raw;

    if (!session.models || session.models.availableModels.length === 0) {
      throw new ValidationError("Agent does not support model switching", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }

    return aggregate;
  }

  private isCurrentModel(session: ChatSession, modelId: string): boolean {
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

  private async sendModelSwitchWithRetry(
    chatId: string,
    session: ChatSession,
    modelId: string
  ): Promise<void> {
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.sessionGateway.setSessionModel(session, modelId);
        return;
      } catch (error) {
        await this.handleModelSwitchFailure({
          error,
          attempt,
          maxAttempts,
          retryBaseDelayMs,
          chatId,
          modelId,
          session,
        });
      }
    }
  }

  private async handleModelSwitchFailure(params: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    chatId: string;
    modelId: string;
    session: ChatSession;
  }): Promise<void> {
    const {
      error,
      attempt,
      maxAttempts,
      retryBaseDelayMs,
      chatId,
      modelId,
      session,
    } = params;

    if (!(error instanceof AiSessionRuntimeError)) {
      throw this.toSetModelFailedError(error, chatId, modelId);
    }

    if (error.kind === "retryable_transport" && attempt < maxAttempts - 1) {
      await this.delayRetry(attempt, retryBaseDelayMs);
      return;
    }

    if (error.kind === "method_not_supported") {
      throw new ValidationError("Agent does not support model switching", {
        module: "ai",
        op: OP,
        details: { chatId, modelId },
      });
    }

    if (
      error.kind === "process_exited" ||
      error.kind === "session_unavailable"
    ) {
      await this.stopSessionAndThrow(chatId, modelId, session, error);
    }

    throw this.toSetModelFailedError(error, chatId, modelId);
  }

  private async stopSessionAndThrow(
    chatId: string,
    modelId: string,
    session: ChatSession,
    error: AiSessionRuntimeError
  ): Promise<never> {
    const reason =
      error.message ||
      (error.kind === "process_exited"
        ? "Agent process exited"
        : "Agent session is unavailable");

    await this.sessionGateway.stopAndCleanup({
      chatId,
      session,
      reason,
      killProcess: error.kind === "process_exited",
    });

    throw new AppError({
      message: reason,
      code:
        error.kind === "process_exited"
          ? "AGENT_PROCESS_EXITED"
          : "SESSION_CONNECTION_CLOSED",
      statusCode:
        error.kind === "process_exited"
          ? HTTP_STATUS.SERVICE_UNAVAILABLE
          : HTTP_STATUS.CONFLICT,
      module: "ai",
      op: OP,
      details: { chatId, modelId },
    });
  }

  private async delayRetry(
    attempt: number,
    retryBaseDelayMs: number
  ): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, getAcpRetryDelayMs(attempt + 1, retryBaseDelayMs));
    });
  }

  private toSetModelFailedError(
    error: unknown,
    chatId: string,
    modelId: string
  ): AppError {
    return new AppError({
      message: error instanceof Error ? error.message : "Failed to set model",
      code: "SET_MODEL_FAILED",
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: OP,
      cause: error,
      details: { chatId, modelId },
    });
  }
}
