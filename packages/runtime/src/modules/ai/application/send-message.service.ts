/**
 * Send Message Service
 *
 * Handles sending user messages to the AI agent and processing the response.
 *
 * @module modules/ai/application/send-message.service
 */

import {
  SessionRealtimeGate,
  type SessionRepositoryPort,
  type SessionRuntimePort,
} from "#runtime/modules/session";
import { AppError, ValidationError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { ChatSession } from "#runtime/shared/types/session.types";
import {
  isBusyChatStatus,
  mapStopReasonToFinishReason,
} from "#runtime/shared/utils/chat-events.util";
import { toStoredContentBlocks } from "#runtime/shared/utils/content-block.util";
import { createId } from "#runtime/shared/utils/id.util";
import { buildUserMessageFromBlocks } from "#runtime/shared/utils/ui-message.util";
import { AI_OP, HTTP_STATUS } from "./ai.constants";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import type { OutputStylePromptPort } from "./ports/output-style-prompt.port";
import type { PromptEnhancerPort } from "./ports/prompt-enhancer.port";
import { buildPrompt } from "./prompt.builder";
import { PayloadBudgetGuard } from "./send-message/payload-budget.guard";
import type { PromptTaskRunner } from "./send-message/prompt-task-runner";
import {
  type NormalizedSendMessagePolicy,
  normalizePromptSource,
  normalizeSendMessagePolicy,
  type PromptLifecycleEvents,
  type PromptLifecycleMessageSent,
  type PromptLifecycleSubagentInvocationRequested,
  type SendMessageExecuteInput,
  type SendMessagePolicy,
  type SendMessageResult,
} from "./send-message/send-message.types";

const OP = AI_OP.PROMPT_SEND;
const LEADING_SLASH_COMMAND_REGEX = /^\/([a-z0-9_-]+)/i;
const OUTPUT_STYLE_SLASH_COMMAND_REGEX = /^\/style-[a-z0-9_-]+/i;

export type { SendMessagePolicy } from "./send-message/send-message.types";

/**
 * Dependencies for prompt submission orchestration.
 *
 * Invariant: repository/runtime/session gateway dependencies must describe the
 * same session store; mixing adapters can persist a prompt to one session while
 * sending ACP traffic to another.
 */
export interface SendMessageServiceDeps {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  sessionGateway: AiSessionRuntimePort;
  sessionRealtimeGate?: SessionRealtimeGate;
  promptTaskRunner: PromptTaskRunner;
  logger: LoggerPort;
  inputPolicy: SendMessagePolicy;
  clock: ClockPort;
  promptLifecycleEvents?: PromptLifecycleEvents;
  promptEnhancer?: PromptEnhancerPort;
  outputStylePrompt?: OutputStylePromptPort;
}

/**
 * Orchestrates one user or supervisor prompt turn.
 *
 * Ordering contract: validation happens before the per-chat runtime lock;
 * inside the lock the service persists the user message, broadcasts it, starts
 * the prompt task, and records active turn state atomically from the caller's
 * point of view.
 */
export class SendMessageService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly sessionRealtimeGate: SessionRealtimeGate;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly promptLifecycleEvents?: PromptLifecycleEvents;
  private readonly promptEnhancer?: PromptEnhancerPort;
  private readonly outputStylePrompt?: OutputStylePromptPort;
  private readonly policy: NormalizedSendMessagePolicy;
  private readonly payloadBudgetGuard: PayloadBudgetGuard;
  private readonly promptTaskRunner: PromptTaskRunner;

  constructor(deps: SendMessageServiceDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.sessionGateway = deps.sessionGateway;
    this.sessionRealtimeGate =
      deps.sessionRealtimeGate ??
      new SessionRealtimeGate({
        sessionRuntime: deps.sessionRuntime,
        logger: deps.logger,
      });
    this.promptTaskRunner = deps.promptTaskRunner;
    this.logger = deps.logger;
    this.clock = deps.clock;
    this.promptLifecycleEvents = deps.promptLifecycleEvents;
    this.promptEnhancer = deps.promptEnhancer;
    this.outputStylePrompt = deps.outputStylePrompt;
    this.policy = normalizeSendMessagePolicy(deps.inputPolicy);
    this.payloadBudgetGuard = new PayloadBudgetGuard(
      this.policy.messagePartsMaxBytes
    );
  }

  async execute(input: SendMessageExecuteInput): Promise<SendMessageResult> {
    this.logger.debug("SendMessageService.execute start", {
      chatId: input.chatId,
      source: input.source ?? "client",
      textLength: input.text.length,
      images: input.images?.length ?? 0,
      audio: input.audio?.length ?? 0,
      resources: input.resources?.length ?? 0,
      resourceLinks: input.resourceLinks?.length ?? 0,
    });
    const textBytes = Buffer.byteLength(input.text, "utf8");
    const slashCommand = extractLeadingSlashCommand(input.text);
    if (slashCommand) {
      this.logger.info("SendMessageService slash command submitted", {
        chatId: input.chatId,
        command: slashCommand,
      });
    }
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
    let messageSentEvent: PromptLifecycleMessageSent | undefined;
    let subagentInvocationEvent:
      | PromptLifecycleSubagentInvocationRequested
      | undefined;
    const result: SendMessageResult = await this.sessionRuntime.runExclusive(
      input.chatId,
      async () => {
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

          // A user-initiated prompt turn is always live traffic.
          // Force replay flags off so incoming ACP chunks are not treated
          // as replay updates (which can suppress live streaming semantics).
          if (session.isReplayingHistory || session.suppressReplayBroadcast) {
            this.logger.warn("SendMessageService clearing stale replay flags", {
              chatId: input.chatId,
              isReplayingHistory: session.isReplayingHistory,
              suppressReplayBroadcast: session.suppressReplayBroadcast,
            });
          }
          session.isReplayingHistory = false;
          session.suppressReplayBroadcast = false;

          const broadcast = this.sessionRuntime.broadcast.bind(
            this.sessionRuntime
          );

          if (
            aggregate.activePromptTask ||
            session.activeTurnId ||
            isBusyChatStatus(session.chatStatus)
          ) {
            throw new AppError({
              message: "A prompt is already in progress for this session",
              code: "PROMPT_BUSY",
              statusCode: HTTP_STATUS.CONFLICT,
              module: "ai",
              op: OP,
              details: {
                chatId: input.chatId,
                activeTurnId: session.activeTurnId,
                activePromptTurnId: aggregate.activePromptTask?.turnId,
                chatStatus: session.chatStatus,
              },
            });
          }

          this.sessionRealtimeGate.assertPromptCanSubmit({
            chatId: input.chatId,
            session,
            source: input.source,
            module: "ai",
            op: OP,
          });

          const turnId = createId("turn");
          aggregate.startTurn(turnId);

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
          const enhancedText = await this.resolveAgentPromptText(
            input,
            session
          );
          const displayPrompt = buildPrompt({
            text: input.text,
            textAnnotations: input.textAnnotations,
            images: input.images,
            audio: input.audio,
            resources: input.resources,
            resourceLinks: input.resourceLinks,
          });
          const agentPrompt =
            enhancedText === input.text
              ? displayPrompt
              : buildPrompt({
                  text: enhancedText,
                  textAnnotations: input.textAnnotations,
                  images: input.images,
                  audio: input.audio,
                  resources: input.resources,
                  resourceLinks: input.resourceLinks,
                });
          const storedPromptBlocks = toStoredContentBlocks(displayPrompt, {
            userId: input.userId,
            chatId: input.chatId,
          });
          const uiMessage = buildUserMessageFromBlocks({
            messageId,
            contentBlocks: storedPromptBlocks,
            createdAt: submittedAt,
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
            aggregate.raw.uiState.currentUserId = uiMessage.id;
            aggregate.raw.uiState.currentUserSource =
              input.source === "supervisor" || input.source === "automation"
                ? input.source
                : "client";
            await this.sessionRuntime.broadcast(input.chatId, {
              type: "ui_message",
              message: uiMessage,
              turnId,
            });

            const promptAbortController = new AbortController();
            const promptTask = this.promptTaskRunner
              .runPromptTask({
                chatId: input.chatId,
                aggregate,
                prompt: agentPrompt,
                broadcast,
                turnId,
                source:
                  input.source === "supervisor" || input.source === "automation"
                    ? input.source
                    : "client",
                abortSignal: promptAbortController.signal,
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
            aggregate.setActivePromptTask({
              turnId,
              promise: promptTask,
              abortController: promptAbortController,
            });
            messageSentEvent = this.buildPromptMessageSentEvent(
              input,
              session,
              turnId
            );
            subagentInvocationEvent =
              this.buildSubagentInvocationRequestedEvent(
                input,
                session,
                turnId
              );
          } catch (error) {
            const errorText =
              error instanceof Error
                ? error.message
                : "Failed to persist user message";
            await this.sessionRuntime.broadcast(input.chatId, {
              type: "error",
              error: errorText,
            });
            await aggregate.markReadyAfterTurnCompletion(
              { chatId: input.chatId, broadcast },
              turnId
            );
            aggregate.clearTurnState();
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
      }
    );
    if (messageSentEvent) {
      await this.promptLifecycleEvents
        ?.afterMessageSend(messageSentEvent)
        .catch((error) => {
          this.logger.warn("SendMessage lifecycle event publish failed", {
            chatId: input.chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if (subagentInvocationEvent) {
      await this.promptLifecycleEvents
        ?.requestSubagentInvocation(subagentInvocationEvent)
        .catch((error) => {
          this.logger.warn("Subagent invocation event publish failed", {
            chatId: input.chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    return result;
  }

  private buildPromptMessageSentEvent(
    input: SendMessageExecuteInput,
    session: ChatSession,
    turnId: string
  ): PromptLifecycleMessageSent {
    return {
      userId: input.userId,
      projectRoot: session.projectRoot,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      chatId: input.chatId,
      ...(session.sessionId ? { agentSessionId: session.sessionId } : {}),
      turnId,
      source: normalizePromptSource(input.source),
    };
  }

  private buildSubagentInvocationRequestedEvent(
    input: SendMessageExecuteInput,
    session: ChatSession,
    turnId: string
  ): PromptLifecycleSubagentInvocationRequested | undefined {
    if (!input.subagent) {
      return undefined;
    }
    return {
      userId: input.userId,
      projectRoot: session.projectRoot,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      chatId: input.chatId,
      ...(session.sessionId ? { agentSessionId: session.sessionId } : {}),
      turnId,
      subagent: {
        name: input.subagent.name,
        ...(input.subagent.description
          ? { description: input.subagent.description }
          : {}),
        sourcePath: input.subagent.sourcePath,
      },
    };
  }

  private async resolveAgentPromptText(
    input: SendMessageExecuteInput,
    session: ChatSession
  ): Promise<string> {
    let resolvedText = input.text;
    if (!this.promptEnhancer) {
      return await this.applyOutputStylePrompt(input, resolvedText);
    }
    try {
      const result = await this.promptEnhancer.enhance({
        userId: input.userId,
        chatId: input.chatId,
        text: resolvedText,
        source: input.source ?? "client",
        projectRoot: session.projectRoot,
        ...(session.projectId ? { projectId: session.projectId } : {}),
      });
      if (result.applied && result.text.trim()) {
        const enhancedBytes = Buffer.byteLength(result.text, "utf8");
        if (enhancedBytes > this.policy.messageContentMaxBytes) {
          this.logger.warn("Prompt enhancement skipped after size check", {
            chatId: input.chatId,
            enhancedBytes,
            maxBytes: this.policy.messageContentMaxBytes,
          });
        } else {
          this.logger.debug("Prompt enhancement applied", {
            chatId: input.chatId,
            rawBytes: Buffer.byteLength(resolvedText, "utf8"),
            enhancedBytes,
          });
          resolvedText = result.text;
        }
      }
    } catch (error) {
      this.logger.warn("Prompt enhancement failed; using original prompt", {
        chatId: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return await this.applyOutputStylePrompt(input, resolvedText);
  }

  private async applyOutputStylePrompt(
    input: SendMessageExecuteInput,
    text: string
  ): Promise<string> {
    if (
      !this.outputStylePrompt ||
      input.source === "supervisor" ||
      hasExplicitOutputStyleInstruction(text)
    ) {
      return text;
    }
    try {
      const prefix = await this.outputStylePrompt.resolvePromptPrefix(
        input.userId
      );
      if (!(prefix.applied && prefix.text.trim())) {
        return text;
      }
      const styledText = `${prefix.text.trim()}\n\nUser request:\n${text}`;
      const styledBytes = Buffer.byteLength(styledText, "utf8");
      if (styledBytes > this.policy.messageContentMaxBytes) {
        this.logger.warn("Output style skipped after size check", {
          chatId: input.chatId,
          presetId: prefix.presetId,
          styledBytes,
          maxBytes: this.policy.messageContentMaxBytes,
        });
        return text;
      }
      this.logger.debug("Output style applied", {
        chatId: input.chatId,
        presetId: prefix.presetId,
        rawBytes: Buffer.byteLength(text, "utf8"),
        styledBytes,
      });
      return styledText;
    } catch (error) {
      this.logger.warn("Output style failed; using previous prompt text", {
        chatId: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return text;
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

function extractLeadingSlashCommand(value: string): string | null {
  const normalized = value.trimStart();
  const match = normalized.match(LEADING_SLASH_COMMAND_REGEX);
  return match?.[1] ?? null;
}

function hasExplicitOutputStyleInstruction(value: string): boolean {
  const normalized = value.trimStart();
  return (
    OUTPUT_STYLE_SLASH_COMMAND_REGEX.test(normalized) ||
    (normalized.startsWith('Respond using the "') &&
      normalized.includes("local output style.") &&
      normalized.includes("Style instructions:"))
  );
}
