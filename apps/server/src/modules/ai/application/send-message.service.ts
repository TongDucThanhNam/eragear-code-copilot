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
import { AppError, NotFoundError, ValidationError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import {
  mapStopReasonToFinishReason,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";
import { toStoredContentBlocks } from "@/shared/utils/content-block.util";
import { createId } from "@/shared/utils/id.util";
import { buildUserMessageFromBlocks } from "@/shared/utils/ui-message.util";
import { AI_OP, HTTP_STATUS } from "./ai.constants";
import { buildPrompt } from "./prompt.builder";
import { PayloadBudgetGuard } from "./send-message/payload-budget.guard";
import { PromptTaskRunner } from "./send-message/prompt-task-runner";
import {
  type NormalizedSendMessagePolicy,
  normalizeSendMessagePolicy,
  type SendMessageExecuteInput,
  type SendMessagePolicy,
  type SendMessageResult,
} from "./send-message/send-message.types";

const OP = AI_OP.PROMPT_SEND;

export type { SendMessagePolicy } from "./send-message/send-message.types";

export class SendMessageService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly policy: NormalizedSendMessagePolicy;
  private readonly payloadBudgetGuard: PayloadBudgetGuard;
  private readonly promptTaskRunner: PromptTaskRunner;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    logger: LoggerPort,
    inputPolicy: SendMessagePolicy,
    clock: ClockPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.logger = logger;
    this.clock = clock;
    this.policy = normalizeSendMessagePolicy(inputPolicy);
    this.payloadBudgetGuard = new PayloadBudgetGuard(
      this.policy.messagePartsMaxBytes
    );
    this.promptTaskRunner = new PromptTaskRunner({
      sessionRepo: this.sessionRepo,
      sessionRuntime: this.sessionRuntime,
      logger: this.logger,
      clock: this.clock,
      policy: {
        acpRetryMaxAttempts: this.policy.acpRetryMaxAttempts,
        acpRetryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
      },
    });
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
        const session = this.requireSession(input.userId, input.chatId);
        this.assertSessionRunning(session, input.chatId);
        this.assertPromptCapabilities(session, input.chatId, input);
        const broadcast = this.sessionRuntime.broadcast.bind(
          this.sessionRuntime
        );

        if (session.activePromptTask) {
          this.logger.warn(
            "SendMessageService replacing active prompt task with a new turn",
            {
              chatId: input.chatId,
              previousTurnId: session.activePromptTask.turnId,
            }
          );
        }

        const turnId = createId("turn");
        session.activeTurnId = turnId;
        session.chatFinish = { turnId };

        await this.promptTaskRunner.cancelActivePrompt({
          chatId: input.chatId,
          session,
          broadcast,
        });

        updateChatStatus({
          chatId: input.chatId,
          session,
          broadcast,
          status: "submitted",
          turnId,
        });
        session.uiState.lastAssistantId = undefined;
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
        session.uiState.messages.set(uiMessage.id, uiMessage);
        this.sessionRuntime.broadcast(input.chatId, {
          type: "ui_message",
          message: uiMessage,
        });

        const promptTask = this.promptTaskRunner.runPromptTask({
          chatId: input.chatId,
          session,
          prompt,
          broadcast,
          turnId,
        });
        session.activePromptTask = {
          turnId,
          promise: promptTask,
        };

        return {
          status: "submitted",
          stopReason: "submitted",
          finishReason: mapStopReasonToFinishReason("submitted"),
          assistantMessageId:
            session.uiState.lastAssistantId ??
            session.uiState.currentAssistantId,
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

  private requireSession(userId: string, chatId: string): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    this.logger.debug("SendMessageService session lookup", {
      chatId,
      hasSession: Boolean(session),
      sessionId: session?.sessionId,
      procPid: session?.proc.pid,
      procKilled: session?.proc.killed,
      procExitCode: session?.proc.exitCode,
      connAborted: session?.conn.signal.aborted,
    });
    if (!session?.sessionId || session.userId !== userId) {
      throw new NotFoundError("Chat not found", {
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    return session;
  }

  private assertSessionRunning(session: ChatSession, chatId: string): void {
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
        statusCode: HTTP_STATUS.CONFLICT,
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    if (session.conn.signal.aborted) {
      throw new AppError({
        message: "Session connection is closed",
        code: "SESSION_CONNECTION_CLOSED",
        statusCode: HTTP_STATUS.CONFLICT,
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
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
