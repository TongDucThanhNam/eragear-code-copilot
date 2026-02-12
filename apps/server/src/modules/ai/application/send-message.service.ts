/**
 * Send Message Service
 *
 * Handles sending user messages to the AI agent and processing the response.
 *
 * @module modules/ai/application/send-message.service
 */

import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { ValidationError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { mapStopReasonToFinishReason } from "@/shared/utils/chat-events.util";
import { toStoredContentBlocks } from "@/shared/utils/content-block.util";
import { createId } from "@/shared/utils/id.util";
import { buildUserMessageFromBlocks } from "@/shared/utils/ui-message.util";
import { AI_OP } from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { buildPrompt } from "./prompt.builder";
import { PayloadBudgetGuard } from "./send-message/payload-budget.guard";
import type { PromptTaskRunner } from "./send-message/prompt-task-runner";
import {
  type NormalizedSendMessagePolicy,
  normalizeSendMessagePolicy,
  type SendMessageExecuteInput,
  type SendMessagePolicy,
  type SendMessageResult,
} from "./send-message/send-message.types";

const OP = AI_OP.PROMPT_SEND;

export type { SendMessagePolicy } from "./send-message/send-message.types";

export interface SendMessageServiceDeps {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  sessionGateway: AiSessionRuntimePort;
  promptTaskRunner: PromptTaskRunner;
  logger: LoggerPort;
  inputPolicy: SendMessagePolicy;
  clock: ClockPort;
}

export class SendMessageService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly policy: NormalizedSendMessagePolicy;
  private readonly payloadBudgetGuard: PayloadBudgetGuard;
  private readonly promptTaskRunner: PromptTaskRunner;

  constructor(deps: SendMessageServiceDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.sessionGateway = deps.sessionGateway;
    this.promptTaskRunner = deps.promptTaskRunner;
    this.logger = deps.logger;
    this.clock = deps.clock;
    this.policy = normalizeSendMessagePolicy(deps.inputPolicy);
    this.payloadBudgetGuard = new PayloadBudgetGuard(
      this.policy.messagePartsMaxBytes
    );
  }

  async execute(input: SendMessageExecuteInput): Promise<SendMessageResult> {
    this.logger.debug("SendMessageService.execute start", {
      chatId: input.chatId,
      textLength: input.text.length,
      images: input.images?.length ?? 0,
      audio: input.audio?.length ?? 0,
      resources: input.resources?.length ?? 0,
      resourceLinks: input.resourceLinks?.length ?? 0,
    });
    const textBytes = Buffer.byteLength(input.text, "utf8");
    if (textBytes > this.policy.messageContentMaxBytes) {
      throw new ValidationError(
        `Prompt text exceeds max size: ${textBytes} bytes > ${this.policy.messageContentMaxBytes}`,
        {
          module: "ai",
          op: OP,
          details: { chatId: input.chatId, textBytes },
        }
      );
    }
    this.payloadBudgetGuard.assertInlineMediaPayloadBudget(input);

    const lockRequestedAt = this.clock.nowMs();
    return await this.sessionRuntime.runExclusive(input.chatId, async () => {
      const lockAcquiredAt = this.clock.nowMs();
      this.logger.debug("SendMessageService execute lock acquired", {
        chatId: input.chatId,
        waitMs: lockAcquiredAt - lockRequestedAt,
      });

      try {
        const aggregate = this.sessionGateway.requireAuthorizedRuntime({
          userId: input.userId,
          chatId: input.chatId,
          module: "ai",
          op: OP,
        });
        const session = aggregate.raw;
        this.logger.debug("SendMessageService session lookup", {
          chatId: input.chatId,
          hasSession: true,
          sessionId: session.sessionId,
          chatStatus: session.chatStatus,
        });

        this.sessionGateway.assertSessionRunning({
          chatId: input.chatId,
          session,
          module: "ai",
          op: OP,
        });

        this.assertPromptCapabilities(session, input.chatId, input);

        const broadcast = this.sessionRuntime.broadcast.bind(
          this.sessionRuntime
        );

        if (aggregate.activePromptTask) {
          this.logger.warn(
            "SendMessageService replacing active prompt task with a new turn",
            {
              chatId: input.chatId,
              previousTurnId: aggregate.activePromptTask.turnId,
            }
          );
        }

        const turnId = createId("turn");
        aggregate.startTurn(turnId);

        await this.promptTaskRunner.cancelActivePrompt({
          chatId: input.chatId,
          aggregate,
          broadcast,
        });

        await aggregate.markSubmitted(
          {
            chatId: input.chatId,
            broadcast,
          },
          turnId
        );
        this.logger.debug("SendMessageService chat status submitted", {
          chatId: input.chatId,
          sessionId: session.sessionId,
        });

        const messageId = createId("msg");
        const submittedAt = this.clock.nowMs();
        const prompt = buildPrompt({
          text: input.text,
          textAnnotations: input.textAnnotations,
          images: input.images,
          audio: input.audio,
          resources: input.resources,
          resourceLinks: input.resourceLinks,
        });
        const storedPromptBlocks = toStoredContentBlocks(prompt);
        const uiMessage = buildUserMessageFromBlocks({
          messageId,
          contentBlocks: storedPromptBlocks,
        });
        try {
          await this.sessionRepo.appendMessage(input.chatId, input.userId, {
            id: messageId,
            role: "user",
            content: input.text,
            contentBlocks: storedPromptBlocks,
            parts: uiMessage.parts,
            timestamp: submittedAt,
          });
          this.logger.debug("SendMessageService user message persisted", {
            chatId: input.chatId,
            messageId,
            contentBlocks: storedPromptBlocks.length,
            parts: uiMessage.parts.length,
            timestamp: submittedAt,
          });
          aggregate.raw.uiState.messages.set(uiMessage.id, uiMessage);
          await this.sessionRuntime.broadcast(input.chatId, {
            type: "ui_message",
            message: uiMessage,
          });

          const promptTask = this.promptTaskRunner
            .runPromptTask({
              chatId: input.chatId,
              aggregate,
              prompt,
              broadcast,
              turnId,
            })
            .catch((error) => {
              const errorText =
                error instanceof Error
                  ? error.message
                  : "Prompt task failed unexpectedly";
              this.logger.error("SendMessageService prompt task rejected", {
                chatId: input.chatId,
                turnId,
                error: errorText,
              });
            });
          aggregate.setActivePromptTask(turnId, promptTask);
        } catch (error) {
          await aggregate.markError(
            { chatId: input.chatId, broadcast },
            turnId
          );
          aggregate.clearTurnState();
          const errorText =
            error instanceof Error
              ? error.message
              : "Failed to persist user message";
          await this.sessionRuntime.broadcast(input.chatId, {
            type: "error",
            error: errorText,
          });
          throw error;
        }

        return {
          status: "submitted",
          stopReason: "submitted",
          finishReason: mapStopReasonToFinishReason("submitted"),
          assistantMessageId: aggregate.assistantMessageId,
          userMessageId: messageId,
          submittedAt,
          turnId,
        };
      } finally {
        this.logger.debug("SendMessageService execute lock released", {
          chatId: input.chatId,
          holdMs: this.clock.nowMs() - lockAcquiredAt,
        });
      }
    });
  }

  private assertPromptCapabilities(
    session: ChatSession,
    chatId: string,
    input: SendMessageExecuteInput
  ): void {
    const capabilities = session.promptCapabilities ?? {};
    this.logger.debug("SendMessageService prompt capabilities", {
      chatId,
      image: Boolean(capabilities.image),
      audio: Boolean(capabilities.audio),
      embeddedContext: Boolean(capabilities.embeddedContext),
    });
    if (input.images?.length && !capabilities.image) {
      throw new ValidationError("Agent does not support image content", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    if (input.audio?.length && !capabilities.audio) {
      throw new ValidationError("Agent does not support audio content", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    if (input.resources?.length && !capabilities.embeddedContext) {
      throw new ValidationError("Agent does not support embedded context", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
  }
}
