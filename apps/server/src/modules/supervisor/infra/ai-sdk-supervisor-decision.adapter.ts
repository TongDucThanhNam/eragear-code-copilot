import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { SupervisorDecisionSummary } from "@/shared/types/supervisor.types";
import type {
  SupervisorDecisionPort,
  SupervisorPermissionSnapshot,
  SupervisorTurnSnapshot,
} from "../application/ports/supervisor-decision.port";
import {
  type SupervisorPermissionDecision,
  SupervisorPermissionDecisionSchema,
  SupervisorTurnDecisionSchema,
} from "../application/supervisor.schemas";
import type { SupervisorPolicy } from "../application/supervisor-policy";
import {
  buildSupervisorPermissionPrompt,
  buildSupervisorTurnPrompt,
  SUPERVISOR_PERMISSION_SYSTEM_PROMPT,
  SUPERVISOR_TURN_SYSTEM_PROMPT,
} from "../application/supervisor-prompt.builder";

export class SupervisorDecisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorDecisionUnavailableError";
  }
}

export class AiSdkSupervisorDecisionAdapter implements SupervisorDecisionPort {
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;

  constructor(policy: SupervisorPolicy, logger: LoggerPort) {
    this.policy = policy;
    this.logger = logger;
  }

  async decideTurn(
    input: SupervisorTurnSnapshot
  ): Promise<SupervisorDecisionSummary> {
    this.assertConfigured();
    try {
      return await this.generateObjectDecision({
        kind: "turn",
        chatId: input.chatId,
        system: SUPERVISOR_TURN_SYSTEM_PROMPT,
        prompt: buildSupervisorTurnPrompt(input),
        schema: SupervisorTurnDecisionSchema,
        name: "supervisor_turn_decision",
      });
    } catch (error) {
      this.logDecisionFailure("turn", input.chatId, error);
      throw error;
    }
  }

  async decidePermission(
    input: SupervisorPermissionSnapshot
  ): Promise<SupervisorPermissionDecision> {
    this.assertConfigured();
    try {
      return await this.generateObjectDecision({
        kind: "permission",
        chatId: input.chatId,
        system: SUPERVISOR_PERMISSION_SYSTEM_PROMPT,
        prompt: buildSupervisorPermissionPrompt(input),
        schema: SupervisorPermissionDecisionSchema,
        name: "supervisor_permission_decision",
      });
    } catch (error) {
      this.logDecisionFailure("permission", input.chatId, error);
      throw error;
    }
  }

  private async generateObjectDecision<T>(params: {
    kind: "turn" | "permission";
    chatId: string;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    name: string;
  }): Promise<T> {
    const model = resolveSupervisorLanguageModel(this.policy);
    const maxAttempts = Math.max(
      1,
      Math.trunc(this.policy.decisionMaxAttempts)
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        this.logger.info("Supervisor model decision attempt started", {
          chatId: params.chatId,
          kind: params.kind,
          attempt,
          maxAttempts,
          model: this.policy.model,
        });
        const { output } = await generateText({
          model,
          system: params.system,
          prompt: params.prompt,
          output: Output.object({
            schema: params.schema,
            name: params.name,
          }),
          timeout: this.policy.decisionTimeoutMs,
          maxRetries: 0,
        });
        this.logger.info("Supervisor model decision attempt completed", {
          chatId: params.chatId,
          kind: params.kind,
          attempt,
          maxAttempts,
        });
        return output;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }
        this.logger.warn("Supervisor decision attempt failed; retrying", {
          chatId: params.chatId,
          kind: params.kind,
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error),
          noObjectGenerated: NoObjectGeneratedError.isInstance(error),
        });
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Supervisor decision failed");
  }

  private assertConfigured(): void {
    if (!this.policy.enabled) {
      throw new SupervisorDecisionUnavailableError("Supervisor is disabled");
    }
    if (this.policy.model.trim().length === 0) {
      throw new SupervisorDecisionUnavailableError(
        "SUPERVISOR_MODEL is required for supervisor decisions"
      );
    }
  }

  private logDecisionFailure(
    kind: "turn" | "permission",
    chatId: string,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn("Supervisor decision failed", {
      chatId,
      kind,
      error: message,
      noObjectGenerated: NoObjectGeneratedError.isInstance(error),
    });
  }
}

function resolveSupervisorLanguageModel(policy: SupervisorPolicy) {
  const trimmedModel = policy.model.trim();
  const deepSeekModel = parseDeepSeekModelId(trimmedModel);
  if (deepSeekModel) {
    const apiKey = policy.deepSeekApiKey?.trim();
    if (!apiKey) {
      throw new SupervisorDecisionUnavailableError(
        "DEEPSEEK_API_KEY is required when SUPERVISOR_MODEL uses deepseek"
      );
    }
    return createDeepSeek({ apiKey })(deepSeekModel);
  }

  throw new SupervisorDecisionUnavailableError(
    `Unsupported SUPERVISOR_MODEL provider: ${trimmedModel}. Supported prefix: deepseek/`
  );
}

function parseDeepSeekModelId(modelId: string): string | undefined {
  if (modelId.startsWith("deepseek/")) {
    return modelId.slice("deepseek/".length).trim() || undefined;
  }
  if (modelId === "deepseek-chat" || modelId === "deepseek-reasoner") {
    return modelId;
  }
  return undefined;
}

export const __aiSdkSupervisorDecisionInternals = {
  parseDeepSeekModelId,
};
