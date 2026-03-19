/**
 * Set Mode Service
 *
 * Changes the active mode for a session, enabling different behavioral
 * configurations for the AI agent.
 *
 * @module modules/ai/application/set-mode.service
 */

import type { SessionRuntimePort } from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { AppError, ValidationError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import {
  findSessionConfigOption,
  hasSessionConfigOptionValue,
  syncSessionSelectionFromConfigOptions,
  updateSessionConfigOptionCurrentValue,
} from "@/shared/utils/session-config-options.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import {
  AI_OP,
  DEFAULT_AI_ACP_RETRY_POLICY,
  HTTP_STATUS,
} from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "./ports/ai-session-runtime.port";

const OP = AI_OP.SESSION_MODE_SET;

interface ModeSwitchPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface ModeSwitchRuntimeContext {
  aggregate: ReturnType<SetModeService["sessionGateway"]["requireAuthorizedRuntime"]>;
  configOptionId?: string;
}

export class SetModeService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly policy: ModeSwitchPolicy;
  private readonly modeSwitchTails = new Map<string, Promise<void>>();

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionGateway: AiSessionRuntimePort,
    policy: ModeSwitchPolicy = {
      acpRetryMaxAttempts: DEFAULT_AI_ACP_RETRY_POLICY.maxAttempts,
      acpRetryBaseDelayMs: DEFAULT_AI_ACP_RETRY_POLICY.retryBaseDelayMs,
    }
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionGateway = sessionGateway;
    this.policy = {
      acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
      acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
    };
  }

  async execute(userId: string, chatId: string, modeId: string) {
    return await this.runModeSwitchSerialized(chatId, async () => {
      const session = await this.sessionRuntime.runExclusive(chatId, async () => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        const context = this.getRuntimeForModeSwitch(userId, chatId, modeId);
        const currentSession = context.aggregate.raw;
        this.sessionGateway.assertSessionRunning({
          chatId,
          session: currentSession,
          module: "ai",
          op: OP,
          details: { modeId },
        });
        return currentSession;
      });

      const nextConfigOptions = await this.sendModeSwitchWithRetry(
        chatId,
        modeId,
        session
      );

      return await this.sessionRuntime.runExclusive(chatId, async () => {
        assertSessionMutationLock({
          sessionRuntime: this.sessionRuntime,
          chatId,
          op: OP,
        });
        const context = this.getRuntimeForModeSwitch(userId, chatId, modeId);
        if (context.aggregate.raw !== session) {
          throw new AppError({
            message:
              "Session runtime changed while switching mode; please retry",
            code: "SESSION_RUNTIME_CHANGED",
            statusCode: HTTP_STATUS.CONFLICT,
            module: "ai",
            op: OP,
            details: { chatId, modeId },
          });
        }
        let configOptionUpdated = false;
        if (context.configOptionId) {
          if (nextConfigOptions && nextConfigOptions.length > 0) {
            session.configOptions = nextConfigOptions;
            configOptionUpdated = true;
          } else {
            configOptionUpdated = updateSessionConfigOptionCurrentValue({
              configOptions: session.configOptions,
              target: "mode",
              value: modeId,
            });
          }
          syncSessionSelectionFromConfigOptions(session);
        } else {
          context.aggregate.setCurrentMode(modeId);
          configOptionUpdated = updateSessionConfigOptionCurrentValue({
            configOptions: session.configOptions,
            target: "mode",
            value: modeId,
          });
          if (configOptionUpdated) {
            syncSessionSelectionFromConfigOptions(session);
          }
        }
        await this.sessionRuntime.broadcast(chatId, {
          type: "current_mode_update",
          modeId,
        });
        if (configOptionUpdated && session.configOptions) {
          await this.sessionRuntime.broadcast(chatId, {
            type: "config_options_update",
            configOptions: session.configOptions,
          });
        }
        return { ok: true };
      });
    });
  }

  private async runModeSwitchSerialized<T>(
    chatId: string,
    work: () => Promise<T>
  ): Promise<T> {
    const previousTail = this.modeSwitchTails.get(chatId) ?? Promise.resolve();
    let releaseTail: () => void = () => undefined;
    const lockSignal = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });
    const nextTail = previousTail.then(
      () => lockSignal,
      () => lockSignal
    );
    this.modeSwitchTails.set(chatId, nextTail);
    await previousTail.catch(() => undefined);
    try {
      return await work();
    } finally {
      releaseTail();
      if (this.modeSwitchTails.get(chatId) === nextTail) {
        this.modeSwitchTails.delete(chatId);
      }
    }
  }

  private getRuntimeForModeSwitch(
    userId: string,
    chatId: string,
    modeId: string
  ): ModeSwitchRuntimeContext {
    const aggregate = this.sessionGateway.requireAuthorizedRuntime({
      userId,
      chatId,
      module: "ai",
      op: OP,
      details: { modeId },
    });
    const session = aggregate.raw;
    const modeOption = findSessionConfigOption(session.configOptions, "mode");

    if (modeOption) {
      if (!hasSessionConfigOptionValue({ option: modeOption, value: modeId })) {
        throw new ValidationError("Mode is not available for this session", {
          module: "ai",
          op: OP,
          details: { chatId, modeId },
        });
      }
      return {
        aggregate,
        configOptionId: modeOption.id,
      };
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

    return { aggregate };
  }

  private async sendModeSwitchWithRetry(
    chatId: string,
    modeId: string,
    session: ChatSession
  ): Promise<ChatSession["configOptions"] | null> {
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });
    const modeOption = findSessionConfigOption(session.configOptions, "mode");

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (modeOption) {
          return await this.sessionGateway.setSessionConfigOption(
            session,
            modeOption.id,
            modeId
          );
        }
        await this.sessionGateway.setSessionMode(session, modeId);
        return null;
      } catch (error) {
        await this.handleModeSwitchFailure({
          error,
          attempt,
          maxAttempts,
          retryBaseDelayMs,
          chatId,
          modeId,
          session,
        });
      }
    }

    return null;
  }

  private async handleModeSwitchFailure(params: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    chatId: string;
    modeId: string;
    session: ChatSession;
  }): Promise<void> {
    const {
      error,
      attempt,
      maxAttempts,
      retryBaseDelayMs,
      chatId,
      modeId,
      session,
    } = params;

    if (!(error instanceof AiSessionRuntimeError)) {
      throw this.toSetModeFailedError(error, chatId, modeId);
    }

    if (error.kind === "retryable_transport" && attempt < maxAttempts - 1) {
      await this.delayRetry(attempt, retryBaseDelayMs);
      return;
    }

    if (error.kind === "method_not_supported") {
      const modeOption = findSessionConfigOption(session.configOptions, "mode");
      throw new ValidationError(
        modeOption
          ? "Agent does not support session configuration updates"
          : "Agent does not support mode switching",
        {
          module: "ai",
          op: OP,
          details: { chatId, modeId },
        }
      );
    }

    if (
      error.kind === "process_exited" ||
      error.kind === "session_unavailable"
    ) {
      await this.stopSessionAndThrow(chatId, modeId, session, error);
    }

    throw this.toSetModeFailedError(error, chatId, modeId);
  }

  private async stopSessionAndThrow(
    chatId: string,
    modeId: string,
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
      details: { chatId, modeId },
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

  private toSetModeFailedError(
    error: unknown,
    chatId: string,
    modeId: string
  ): AppError {
    return new AppError({
      message: error instanceof Error ? error.message : "Failed to set mode",
      code: "SET_MODE_FAILED",
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: OP,
      cause: error,
      details: { chatId, modeId },
    });
  }
}
