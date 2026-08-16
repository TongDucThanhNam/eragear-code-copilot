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
} from "#runtime/modules/session";
import { assertSessionMutationLock } from "#runtime/modules/session/application/session-runtime-lock.assert";
import { AppError, ValidationError } from "#runtime/shared/errors";
import type { ChatSession } from "#runtime/shared/types/session.types";
import {
  capSessionSelectionState,
  findSessionConfigOption,
  getSessionConfigOptionCurrentValue,
  hasSessionConfigOptionValue,
  shouldStripAvailableModelsForAgent,
  syncSessionSelectionFromConfigOptions,
  updateSessionConfigOptionCurrentValue,
} from "#runtime/shared/utils/session-config-options.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import {
  AI_OP,
  DEFAULT_AI_ACP_RETRY_POLICY,
  HTTP_STATUS,
} from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";
import { persistSessionSelectionState } from "./session-selection-persistence";

const OP = AI_OP.SESSION_MODEL_SET;

interface ModelSwitchPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface ModelSwitchRuntimeContext {
  aggregate: ReturnType<
    SetModelService["sessionGateway"]["requireAuthorizedRuntime"]
  >;
  configOptionId?: string;
}

/**
 * Switches the active model for one session.
 *
 * Caller contract: requested model IDs must already be exposed by the runtime
 * model/config option state; transient ACP failures are retried, while exited
 * or closed sessions are stopped and surfaced as typed errors.
 */
export class SetModelService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort | undefined;
  private readonly policy: ModelSwitchPolicy;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionGateway: AiSessionRuntimePort,
    policy: ModelSwitchPolicy = {
      acpRetryMaxAttempts: DEFAULT_AI_ACP_RETRY_POLICY.maxAttempts,
      acpRetryBaseDelayMs: DEFAULT_AI_ACP_RETRY_POLICY.retryBaseDelayMs,
    },
    sessionRepo?: SessionRepositoryPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionGateway = sessionGateway;
    this.sessionRepo = sessionRepo;
    this.policy = {
      acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
      acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
    };
  }

  async execute(userId: string, chatId: string, modelId: string) {
    return await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: OP,
      });
      const context = this.getRuntimeForModelSwitch(userId, chatId, modelId);
      const session = context.aggregate.raw;
      if (this.isCurrentModel(session, modelId)) {
        return { ok: true, configOptions: session.configOptions ?? [] };
      }

      this.sessionGateway.assertSessionRunning({
        chatId,
        session,
        module: "ai",
        op: OP,
        details: { modelId },
      });

      const nextConfigOptions = await this.sendModelSwitchWithRetry(
        chatId,
        session,
        modelId
      );

      let configOptionUpdated = false;
      if (context.configOptionId) {
        if (nextConfigOptions && nextConfigOptions.length > 0) {
          session.configOptions = nextConfigOptions;
          configOptionUpdated = true;
        } else {
          configOptionUpdated = updateSessionConfigOptionCurrentValue({
            configOptions: session.configOptions,
            target: "model",
            value: modelId,
          });
        }
        syncSessionSelectionFromConfigOptions(session);
      } else {
        context.aggregate.setCurrentModel(modelId);
        configOptionUpdated = updateSessionConfigOptionCurrentValue({
          configOptions: session.configOptions,
          target: "model",
          value: modelId,
        });
        if (configOptionUpdated) {
          syncSessionSelectionFromConfigOptions(session);
        }
      }

      await this.sessionRuntime.broadcast(chatId, {
        type: "current_model_update",
        modelId,
      });
      if (configOptionUpdated && session.configOptions) {
        const capped = capSessionSelectionState({
          models: session.models,
          configOptions: session.configOptions,
          stripAvailableModels: shouldStripAvailableModelsForAgent(
            session.agentInfo
          ),
        });
        await this.sessionRuntime.broadcast(chatId, {
          type: "config_options_update",
          configOptions: capped.configOptions,
        });
      }
      await persistSessionSelectionState({
        sessionRepo: this.sessionRepo,
        chatId,
        session,
      });
      return { ok: true, configOptions: session.configOptions ?? [] };
    });
  }

  private getRuntimeForModelSwitch(
    userId: string,
    chatId: string,
    modelId: string
  ): ModelSwitchRuntimeContext {
    const aggregate = this.sessionGateway.requireAuthorizedRuntime({
      userId,
      chatId,
      module: "ai",
      op: OP,
    });
    const session = aggregate.raw;
    const modelOption = findSessionConfigOption(session.configOptions, "model");

    if (modelOption) {
      if (
        !hasSessionConfigOptionValue({ option: modelOption, value: modelId })
      ) {
        throw new ValidationError("Model is not available for this session", {
          module: "ai",
          op: OP,
          details: { chatId, modelId },
        });
      }
      return {
        aggregate,
        configOptionId: modelOption.id,
      };
    }

    if (!session.models || session.models.availableModels.length === 0) {
      throw new ValidationError("Agent does not support model switching", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }

    return { aggregate };
  }

  private isCurrentModel(session: ChatSession, modelId: string): boolean {
    const configModelId = getSessionConfigOptionCurrentValue({
      configOptions: session.configOptions,
      target: "model",
    });
    if (configModelId) {
      if (
        !hasSessionConfigOptionValue({
          option: findSessionConfigOption(session.configOptions, "model"),
          value: modelId,
        })
      ) {
        throw new ValidationError("Model is not available for this session", {
          module: "ai",
          op: OP,
          details: { chatId: session.id, modelId },
        });
      }
      return configModelId === modelId;
    }

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
  ): Promise<ChatSession["configOptions"] | null> {
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });
    const modelOption = findSessionConfigOption(session.configOptions, "model");

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (modelOption) {
          return await this.sessionGateway.setSessionConfigOption(
            session,
            modelOption.id,
            modelId
          );
        }
        await this.sessionGateway.setSessionModel(session, modelId);
        return null;
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

    return null;
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
      const modelOption = findSessionConfigOption(
        session.configOptions,
        "model"
      );
      throw new ValidationError(
        modelOption
          ? "Agent does not support session configuration updates"
          : "Agent does not support model switching",
        {
          module: "ai",
          op: OP,
          details: { chatId, modelId },
        }
      );
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
