import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { AppError, ValidationError } from "@/shared/errors";
import type {
  ChatSession,
  SessionConfigOption,
} from "@/shared/types/session.types";
import {
  capSessionSelectionState,
  isSessionConfigSelectOption,
  shouldStripAvailableModelsForAgent,
  syncSessionSelectionFromConfigOptions,
} from "@/shared/utils/session-config-options.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import {
  AI_OP,
  DEFAULT_AI_ACP_RETRY_POLICY,
  HTTP_STATUS,
} from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";
import { persistSessionSelectionState } from "./session-selection-persistence";

const OP = AI_OP.SESSION_CONFIG_OPTION_SET;

interface ConfigOptionSwitchPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface SessionConfigSelectOptionValue {
  value?: string;
}

interface SessionConfigSelectGroupValue {
  options?: SessionConfigSelectOptionValue[];
}

function isConfigSelectGroup(
  value: SessionConfigSelectOptionValue | SessionConfigSelectGroupValue
): value is SessionConfigSelectGroupValue {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SessionConfigSelectGroupValue).options)
  );
}

function collectConfigOptionValues(option: SessionConfigOption): Set<string> {
  const out = new Set<string>();
  if (!isSessionConfigSelectOption(option)) {
    return out;
  }
  for (const item of option.options ?? []) {
    if (isConfigSelectGroup(item)) {
      for (const nested of item.options ?? []) {
        if (typeof nested.value === "string" && nested.value.length > 0) {
          out.add(nested.value);
        }
      }
      continue;
    }
    if (typeof item.value === "string" && item.value.length > 0) {
      out.add(item.value);
    }
  }
  return out;
}

/**
 * Updates a runtime session configuration option exposed by the agent.
 *
 * Invariant: the value must exist in the option's advertised select values
 * before any ACP call is made; returned config options become the new runtime
 * source of truth when the agent supplies them.
 */
export class SetConfigOptionService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort | undefined;
  private readonly policy: ConfigOptionSwitchPolicy;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionGateway: AiSessionRuntimePort,
    policy: ConfigOptionSwitchPolicy = {
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

  async execute(
    userId: string,
    chatId: string,
    configId: string,
    value: string
  ): Promise<{ ok: true; configOptions: SessionConfigOption[] }> {
    return await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: OP,
      });

      const aggregate = this.sessionGateway.requireAuthorizedRuntime({
        userId,
        chatId,
        module: "ai",
        op: OP,
        details: { configId },
      });
      const session = aggregate.raw;

      if (!session.configOptions || session.configOptions.length === 0) {
        throw new ValidationError(
          "Agent does not expose session configuration options",
          {
            module: "ai",
            op: OP,
            details: { chatId, configId },
          }
        );
      }

      const targetOption = session.configOptions.find(
        (option) => option.id === configId
      );
      if (!targetOption) {
        throw new ValidationError(
          "Config option is not available for this session",
          {
            module: "ai",
            op: OP,
            details: { chatId, configId },
          }
        );
      }

      const availableValues = collectConfigOptionValues(targetOption);
      if (!availableValues.has(value)) {
        throw new ValidationError("Config option value is not valid", {
          module: "ai",
          op: OP,
          details: { chatId, configId, value },
        });
      }

      if (targetOption.currentValue === value) {
        return { ok: true, configOptions: session.configOptions ?? [] };
      }

      this.sessionGateway.assertSessionRunning({
        chatId,
        session,
        module: "ai",
        op: OP,
        details: { configId, value },
      });

      const nextOptions = await this.sendConfigOptionWithRetry(
        chatId,
        configId,
        value,
        session
      );
      session.configOptions =
        nextOptions.length > 0
          ? nextOptions
          : session.configOptions.map((option) =>
              option.id === configId && isSessionConfigSelectOption(option)
                ? { ...option, currentValue: value }
                : option
            );
      const selection = syncSessionSelectionFromConfigOptions(session);
      await persistSessionSelectionState({
        sessionRepo: this.sessionRepo,
        chatId,
        session,
      });

      const capped = capSessionSelectionState({
        models: session.models,
        configOptions: session.configOptions,
        maxVisible: DEFAULT_MAX_VISIBLE_MODEL_COUNT,
        stripAvailableModels: shouldStripAvailableModelsForAgent(
          session.agentInfo
        ),
      });
      await this.sessionRuntime.broadcast(chatId, {
        type: "config_options_update",
        configOptions: capped.configOptions,
      });
      if (selection.modeChanged && selection.modeId) {
        await this.sessionRuntime.broadcast(chatId, {
          type: "current_mode_update",
          modeId: selection.modeId,
          reason: "config_option_update",
          metadata: {
            source: "set_config_option",
            configId,
          },
        });
      }
      if (selection.modelChanged && selection.modelId) {
        await this.sessionRuntime.broadcast(chatId, {
          type: "current_model_update",
          modelId: selection.modelId,
        });
      }

      return { ok: true, configOptions: session.configOptions };
    });
  }

  private async sendConfigOptionWithRetry(
    chatId: string,
    configId: string,
    value: string,
    session: ChatSession
  ): Promise<SessionConfigOption[]> {
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.sessionGateway.setSessionConfigOption(
          session,
          configId,
          value
        );
      } catch (error) {
        await this.handleConfigOptionFailure({
          error,
          attempt,
          maxAttempts,
          retryBaseDelayMs,
          chatId,
          configId,
          value,
          session,
        });
      }
    }

    return [];
  }

  private async handleConfigOptionFailure(params: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    chatId: string;
    configId: string;
    value: string;
    session: ChatSession;
  }): Promise<void> {
    const {
      error,
      attempt,
      maxAttempts,
      retryBaseDelayMs,
      chatId,
      configId,
      value,
      session,
    } = params;

    if (!(error instanceof AiSessionRuntimeError)) {
      throw this.toSetConfigOptionFailedError(error, chatId, configId, value);
    }

    if (error.kind === "retryable_transport" && attempt < maxAttempts - 1) {
      await this.delayRetry(attempt, retryBaseDelayMs);
      return;
    }

    if (error.kind === "method_not_supported") {
      throw new ValidationError(
        "Agent does not support session configuration updates",
        {
          module: "ai",
          op: OP,
          details: { chatId, configId, value },
        }
      );
    }

    if (
      error.kind === "process_exited" ||
      error.kind === "session_unavailable"
    ) {
      await this.stopSessionAndThrow(chatId, configId, value, session, error);
    }

    throw this.toSetConfigOptionFailedError(error, chatId, configId, value);
  }

  private async stopSessionAndThrow(
    chatId: string,
    configId: string,
    value: string,
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
      details: { chatId, configId, value },
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

  private toSetConfigOptionFailedError(
    error: unknown,
    chatId: string,
    configId: string,
    value: string
  ): AppError {
    return new AppError({
      message:
        error instanceof Error ? error.message : "Failed to set config option",
      code: "SET_CONFIG_OPTION_FAILED",
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: OP,
      cause: error,
      details: { chatId, configId, value },
    });
  }
}
