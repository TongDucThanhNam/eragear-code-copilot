import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { SupervisorSemanticDecision } from "#runtime/shared/types/supervisor.types";
import { mapSemanticToRuntime } from "#runtime/shared/types/supervisor.types";
import type {
  SupervisorDecisionPort,
  SupervisorPermissionSnapshot,
  SupervisorTurnSnapshot,
} from "../application/ports/supervisor-decision.port";
import {
  type SupervisorPermissionDecision,
  SupervisorPermissionDecisionSchema,
  SupervisorSemanticDecisionSchema,
} from "../application/supervisor.schemas";
import type { SupervisorPolicy } from "../application/supervisor-policy";
import {
  buildSupervisorPermissionPrompt,
  buildSupervisorPermissionSystemPrompt,
  buildSupervisorTurnPrompt,
  buildSupervisorTurnSystemPrompt,
} from "../application/supervisor-prompt.builder";

export class SupervisorDecisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorDecisionUnavailableError";
  }
}

type MiniMaxProvider = ReturnType<typeof createOpenAICompatible>;
type MiniMaxLanguageModel = ReturnType<MiniMaxProvider>;
type GenerateTextFn = typeof generateText;

const MINIMAX_PROVIDER_NAME = "minimax";
const MINIMAX_OPENAI_BASE_URL = "https://api.minimax.io/v1";
const MINIMAX_MODEL_PREFIX = "minimax/";

export class AiSdkSupervisorDecisionAdapter implements SupervisorDecisionPort {
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly generate: GenerateTextFn;
  private readonly resolveModel: (
    policy: SupervisorPolicy
  ) => MiniMaxLanguageModel;

  constructor(
    policy: SupervisorPolicy,
    logger: LoggerPort,
    options: {
      generateText?: GenerateTextFn;
      resolveModel?: (policy: SupervisorPolicy) => MiniMaxLanguageModel;
    } = {}
  ) {
    this.policy = policy;
    this.logger = logger;
    this.generate = options.generateText ?? generateText;
    this.resolveModel = options.resolveModel ?? resolveSupervisorLanguageModel;
  }

  async decideTurn(
    input: SupervisorTurnSnapshot
  ): Promise<SupervisorSemanticDecision> {
    this.assertConfigured();
    try {
      // R1 — Parse LLM output using semantic schema and compute runtimeAction
      const raw = await this.generateObjectDecision({
        kind: "turn",
        chatId: input.chatId,
        system: buildSupervisorTurnSystemPrompt(this.policy),
        prompt: buildSupervisorTurnPrompt(input),
        schema: SupervisorSemanticDecisionSchema,
        name: "supervisor_turn_decision",
      });
      const runtimeAction = mapSemanticToRuntime(raw.semanticAction);
      return {
        semanticAction: raw.semanticAction,
        runtimeAction,
        reason: raw.reason,
        ...(raw.followUpPrompt ? { followUpPrompt: raw.followUpPrompt } : {}),
      };
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
        system: buildSupervisorPermissionSystemPrompt(this.policy),
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
    const model = this.resolveModel(this.policy);
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
        const { output } = await this.generate({
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
        return params.schema.parse(output);
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
        "Supervisor model is required in Settings for supervisor decisions"
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

export function resolveSupervisorLanguageModel(policy: SupervisorPolicy) {
  const trimmedModel = policy.model.trim();
  const miniMaxModel = parseMiniMaxModelId(trimmedModel);
  if (miniMaxModel) {
    const apiKey = policy.miniMaxApiKey?.trim();
    if (!apiKey) {
      throw new SupervisorDecisionUnavailableError(
        "MiniMax API key is required in Settings or MINIMAX_API_KEY for supervisor decisions"
      );
    }
    const provider = createOpenAICompatible({
      name: MINIMAX_PROVIDER_NAME,
      apiKey,
      baseURL: MINIMAX_OPENAI_BASE_URL,
      supportsStructuredOutputs: true,
    });
    return provider(miniMaxModel);
  }

  throw new SupervisorDecisionUnavailableError(
    `Unsupported supervisor model provider: ${trimmedModel}. Supported model: MiniMax-M3`
  );
}

function parseMiniMaxModelId(modelId: string): string | undefined {
  const trimmed = modelId.trim();
  if (trimmed.startsWith(MINIMAX_MODEL_PREFIX)) {
    const unprefixed = trimmed.slice(MINIMAX_MODEL_PREFIX.length).trim();
    return isSupportedMiniMaxSupervisorModel(unprefixed)
      ? unprefixed
      : undefined;
  }
  if (isSupportedMiniMaxSupervisorModel(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function isSupportedMiniMaxSupervisorModel(modelId: string): boolean {
  return modelId === "MiniMax-M3";
}

export const __aiSdkSupervisorDecisionInternals = {
  MINIMAX_OPENAI_BASE_URL,
  parseMiniMaxModelId,
  resolveSupervisorLanguageModel,
};
