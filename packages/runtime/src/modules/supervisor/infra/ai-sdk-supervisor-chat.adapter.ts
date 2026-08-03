import { generateText } from "ai";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { SupervisorChatPort } from "../application/ports/supervisor-chat.port";
import type { SupervisorPolicy } from "../application/supervisor-policy";
import {
  buildSupervisorChatPrompt,
  buildSupervisorChatSystemPrompt,
} from "../application/supervisor-prompt.builder";
import {
  resolveSupervisorLanguageModel,
  SupervisorDecisionUnavailableError,
} from "./ai-sdk-supervisor-decision.adapter";

type GenerateTextFn = typeof generateText;

const COMPLETE_THINKING_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const UNTERMINATED_THINKING_BLOCK_PATTERN = /^<think>[\s\S]*$/i;
const CLOSING_THINKING_TAG_PATTERN = /<\/think>/gi;

export class AiSdkSupervisorChatAdapter implements SupervisorChatPort {
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly generate: GenerateTextFn;

  constructor(
    policy: SupervisorPolicy,
    logger: LoggerPort,
    options: { generateText?: GenerateTextFn } = {}
  ) {
    this.policy = policy;
    this.logger = logger;
    this.generate = options.generateText ?? generateText;
  }

  async respond(input: Parameters<SupervisorChatPort["respond"]>[0]) {
    this.assertConfigured();
    const model = resolveSupervisorLanguageModel(this.policy);
    try {
      this.logger.info("Supervisor side chat response started", {
        chatId: input.chatId,
        model: this.policy.model,
      });
      const result = await this.generate({
        model,
        system: buildSupervisorChatSystemPrompt(this.policy),
        prompt: buildSupervisorChatPrompt(input),
        timeout: this.policy.decisionTimeoutMs,
        maxRetries: 0,
      });
      const content = stripThinkingBlocks(result.text).trim();
      this.logger.info("Supervisor side chat response completed", {
        chatId: input.chatId,
        model: this.policy.model,
      });
      return {
        content:
          content.length > 0
            ? content
            : "Supervisos did not return a response.",
        model: this.policy.model,
        provider: "minimax" as const,
      };
    } catch (error) {
      this.logger.warn("Supervisor side chat response failed", {
        chatId: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private assertConfigured(): void {
    if (!this.policy.enabled) {
      throw new SupervisorDecisionUnavailableError("Supervisor is disabled");
    }
    if (this.policy.model.trim().length === 0) {
      throw new SupervisorDecisionUnavailableError(
        "Supervisor model is required in Settings for supervisor chat"
      );
    }
  }
}

export function stripThinkingBlocks(value: string): string {
  let cleaned = value.replace(COMPLETE_THINKING_BLOCK_PATTERN, "").trim();
  cleaned = cleaned.replace(UNTERMINATED_THINKING_BLOCK_PATTERN, "").trim();
  cleaned = cleaned.replace(CLOSING_THINKING_TAG_PATTERN, "").trim();
  return cleaned;
}
