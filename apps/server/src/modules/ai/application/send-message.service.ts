/**
 * Send Message Service
 *
 * Handles sending user messages to the AI agent and processing the response.
 * Manages message persistence, broadcasting, and response handling.
 *
 * @module modules/ai/application/send-message.service
 */

import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { AppError, NotFoundError, ValidationError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import {
  mapStopReasonToFinishReason,
  maybeBroadcastChatFinish,
  setChatFinishStopReason,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";
import { toStoredContentBlocks } from "../../../shared/utils/content-block.util";
import { createId } from "../../../shared/utils/id.util";
import {
  buildUserMessageFromBlocks,
  finalizeStreamingParts,
} from "../../../shared/utils/ui-message.util";
import {
  getAcpErrorText,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "./acp-retry-policy";
import { buildPrompt } from "./prompt.builder";

const OP = "ai.prompt.send";

export interface SendMessagePolicy {
  messageContentMaxBytes: number;
  messagePartsMaxBytes: number;
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface NormalizedSendMessagePolicy {
  messageContentMaxBytes: number;
  messagePartsMaxBytes: number;
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

function normalizePolicy(
  policy: SendMessagePolicy
): NormalizedSendMessagePolicy {
  return {
    messageContentMaxBytes: Math.max(
      1,
      Math.trunc(policy.messageContentMaxBytes)
    ),
    messagePartsMaxBytes: Math.max(1, Math.trunc(policy.messagePartsMaxBytes)),
    acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
    acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
  };
}

interface SendMessageExecuteInput {
  /** Owning user identifier */
  userId: string;
  /** The chat session identifier */
  chatId: string;
  /** The text content of the message */
  text: string;
  /** Optional annotations for the text content */
  textAnnotations?: Record<string, unknown>;
  /** Optional images to include in the message */
  images?: {
    base64: string;
    mimeType: string;
    uri?: string;
    annotations?: Record<string, unknown>;
  }[];
  /** Optional audio clips to include in the message */
  audio?: {
    base64: string;
    mimeType: string;
    annotations?: Record<string, unknown>;
  }[];
  /** Optional resources to include in the message */
  resources?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
    annotations?: Record<string, unknown>;
  }[];
  /** Optional resource links to include in the message */
  resourceLinks?: {
    uri: string;
    name: string;
    mimeType?: string;
    title?: string;
    description?: string;
    size?: number;
    annotations?: Record<string, unknown>;
  }[];
}

/**
 * SendMessageService
 *
 * Core service for sending user messages to an active session.
 * Handles message creation, persistence, broadcasting, and response processing.
 *
 * @example
 * ```typescript
 * const service = new SendMessageService(sessionRepo, sessionRuntime, logger, {
 *   messageContentMaxBytes: 1000000,
 *   messagePartsMaxBytes: 1000000,
 *   acpRetryMaxAttempts: 3,
 *   acpRetryBaseDelayMs: 200,
 * });
 * const result = await service.execute({
 *   chatId: "chat-123",
 *   text: "Hello, agent!"
 * });
 * console.log(result.stopReason);
 * ```
 */
export class SendMessageService {
  /** Repository for message persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;
  /** Application logger */
  private readonly logger: LoggerPort;
  /** Runtime policy for validation and retry behavior */
  private readonly policy: NormalizedSendMessagePolicy;

  /**
   * Creates a SendMessageService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    logger: LoggerPort,
    policy: SendMessagePolicy
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.logger = logger;
    this.policy = normalizePolicy(policy);
  }

  /**
   * Sends a message to the agent and handles the response
   *
   * @param input - Message input parameters
   * @returns Object containing the stop reason and related metadata
   * @throws Error if session is not found or not running
   */
  async execute(input: SendMessageExecuteInput): Promise<{
    status: "submitted";
    stopReason: string;
    finishReason: string;
    assistantMessageId?: string;
    userMessageId: string;
    submittedAt: number;
    turnId: string;
  }> {
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
    this.assertInlineMediaPayloadBudget(input);
    const lockRequestedAt = Date.now();
    return await this.sessionRuntime.runExclusive(input.chatId, async () => {
      const lockAcquiredAt = Date.now();
      this.logger.debug("SendMessageService execute lock acquired", {
        chatId: input.chatId,
        waitMs: lockAcquiredAt - lockRequestedAt,
      });
      try {
        const session = this.sessionRuntime.get(input.chatId);
        this.logger.debug("SendMessageService session lookup", {
          chatId: input.chatId,
          hasSession: Boolean(session),
          sessionId: session?.sessionId,
          procPid: session?.proc.pid,
          procKilled: session?.proc.killed,
          procExitCode: session?.proc.exitCode,
          connAborted: session?.conn.signal.aborted,
        });
        if (!session?.sessionId) {
          throw new NotFoundError("Chat not found", {
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }
        if (session.userId !== input.userId) {
          throw new NotFoundError("Chat not found", {
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }
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
            statusCode: 409,
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }
        if (session.conn.signal.aborted) {
          throw new AppError({
            message: "Session connection is closed",
            code: "SESSION_CONNECTION_CLOSED",
            statusCode: 409,
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }

        const capabilities = session.promptCapabilities ?? {};
        this.logger.debug("SendMessageService prompt capabilities", {
          chatId: input.chatId,
          image: Boolean(capabilities.image),
          audio: Boolean(capabilities.audio),
          embeddedContext: Boolean(capabilities.embeddedContext),
        });
        if (input.images?.length && !capabilities.image) {
          throw new ValidationError("Agent does not support image content", {
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }
        if (input.audio?.length && !capabilities.audio) {
          throw new ValidationError("Agent does not support audio content", {
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }
        if (input.resources?.length && !capabilities.embeddedContext) {
          throw new ValidationError("Agent does not support embedded context", {
            module: "ai",
            op: OP,
            details: { chatId: input.chatId },
          });
        }

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

        const msgId = createId("msg");
        const msgTimestamp = Date.now();

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
          messageId: msgId,
          contentBlocks: storedPromptBlocks,
        });
        await this.sessionRepo.appendMessage(input.chatId, input.userId, {
          id: msgId,
          role: "user",
          content: input.text,
          contentBlocks: storedPromptBlocks,
          parts: uiMessage.parts,
          timestamp: msgTimestamp,
        });
        this.logger.debug("SendMessageService user message persisted", {
          chatId: input.chatId,
          messageId: msgId,
          contentBlocks: storedPromptBlocks.length,
          parts: uiMessage.parts.length,
          timestamp: msgTimestamp,
        });
        session.uiState.messages.set(uiMessage.id, uiMessage);
        this.sessionRuntime.broadcast(input.chatId, {
          type: "ui_message",
          message: uiMessage,
        });
        this.logger.debug("SendMessageService user message broadcast", {
          chatId: input.chatId,
          messageId: msgId,
        });

        const promptTask = this.runPromptTask({
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
          status: "submitted" as const,
          stopReason: "submitted",
          finishReason: mapStopReasonToFinishReason("submitted"),
          assistantMessageId:
            session.uiState.lastAssistantId ??
            session.uiState.currentAssistantId,
          userMessageId: msgId,
          submittedAt: msgTimestamp,
          turnId,
        };
      } finally {
        this.logger.debug("SendMessageService execute lock released", {
          chatId: input.chatId,
          holdMs: Date.now() - lockAcquiredAt,
        });
      }
    });
  }

  private async handlePrompt(params: {
    chatId: string;
    session: ChatSession;
    prompt: ReturnType<typeof buildPrompt>;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
  }): Promise<void> {
    const { chatId, session, prompt, broadcast, turnId } = params;
    const isCurrentTurn = () => session.activeTurnId === turnId;
    const sessionId = session.sessionId;
    if (!sessionId) {
      await this.markSessionStopped({
        chatId,
        session,
        broadcast,
        turnId,
        reason: "Session is missing ACP session id",
        includeTurnId: isCurrentTurn(),
      });
      return;
    }
    const res = await this.requestPromptWithRetries({
      chatId,
      session,
      sessionId,
      prompt,
      broadcast,
      turnId,
      isCurrentTurn,
    });
    if (!res) {
      return;
    }
    if (!isCurrentTurn()) {
      this.logger.warn("SendMessageService ignoring stale prompt completion", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        stopReason: res.stopReason,
      });
      return;
    }
    await this.finalizePromptSuccess({
      chatId,
      session,
      broadcast,
      turnId,
      stopReason: res.stopReason,
    });
  }

  private async runPromptTask(params: {
    chatId: string;
    session: ChatSession;
    prompt: ReturnType<typeof buildPrompt>;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
  }): Promise<void> {
    const { chatId, session, turnId, broadcast } = params;
    try {
      await this.handlePrompt(params);
    } catch (error) {
      const errorText = getAcpErrorText(error);
      const normalizedError =
        errorText?.trim() ||
        (error instanceof Error ? error.message : "Unexpected prompt failure");
      const isCurrentTurn = session.activeTurnId === turnId;

      this.logger.error("SendMessageService prompt task crashed", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        error: normalizedError,
      });

      if (isCurrentTurn) {
        updateChatStatus({
          chatId,
          session,
          broadcast,
          status: "error",
          turnId,
        });
        session.activeTurnId = undefined;
        this.sessionRuntime.broadcast(chatId, {
          type: "error",
          error: normalizedError,
        });
      }
    } finally {
      if (session.activePromptTask?.turnId === turnId) {
        session.activePromptTask = undefined;
      }
    }
  }

  private async requestPromptWithRetries(params: {
    chatId: string;
    session: ChatSession;
    sessionId: string;
    prompt: ReturnType<typeof buildPrompt>;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    isCurrentTurn: () => boolean;
  }): Promise<{ stopReason: string } | null> {
    const {
      chatId,
      session,
      sessionId,
      prompt,
      broadcast,
      turnId,
      isCurrentTurn,
    } = params;
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.logger.debug("SendMessageService sending prompt", {
          chatId,
          sessionId,
          attempt: attempt + 1,
          maxAttempts,
          turnId,
        });
        const response = await session.conn.prompt({
          sessionId,
          prompt,
        });
        this.logger.debug("SendMessageService prompt response", {
          chatId,
          stopReason: response.stopReason,
          turnId,
        });
        return response;
      } catch (error) {
        const errorText = getAcpErrorText(error);
        this.logger.warn("SendMessageService prompt error", {
          chatId,
          attempt: attempt + 1,
          maxAttempts,
          error: errorText || "unknown",
          turnId,
        });
        if (
          isProcessTransportNotReady(errorText) &&
          attempt < maxAttempts - 1
        ) {
          await new Promise((resolve) => {
            setTimeout(
              resolve,
              getAcpRetryDelayMs(attempt + 1, retryBaseDelayMs)
            );
          });
          continue;
        }
        if (isProcessExited(errorText)) {
          await this.markSessionStopped({
            chatId,
            session,
            broadcast,
            turnId,
            reason: errorText || "Agent process exited",
            includeTurnId: isCurrentTurn(),
          });
          return null;
        }
        if (!isCurrentTurn()) {
          this.logger.warn("SendMessageService ignoring stale prompt error", {
            chatId,
            turnId,
            activeTurnId: session.activeTurnId,
            error: errorText || "unknown",
          });
          return null;
        }

        updateChatStatus({
          chatId,
          session,
          broadcast,
          status: "error",
          turnId,
        });
        session.activeTurnId = undefined;
        throw new AppError({
          message: errorText || "Failed to send message",
          code: "SEND_MESSAGE_FAILED",
          statusCode: 502,
          module: "ai",
          op: OP,
          cause: error,
          details: { chatId, turnId },
        });
      }
    }

    this.logger.warn("SendMessageService failed to get prompt response", {
      chatId,
      attempts: maxAttempts,
      turnId,
    });
    if (!isCurrentTurn()) {
      this.logger.warn("SendMessageService stale turn without response", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
      });
      return null;
    }

    updateChatStatus({
      chatId,
      session,
      broadcast,
      status: "error",
      turnId,
    });
    session.activeTurnId = undefined;
    throw new AppError({
      message: "Failed to send message",
      code: "SEND_MESSAGE_FAILED",
      statusCode: 502,
      module: "ai",
      op: OP,
      details: { chatId, turnId },
    });
  }

  private async finalizePromptSuccess(params: {
    chatId: string;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    stopReason: string;
  }): Promise<void> {
    const { chatId, session, broadcast, turnId, stopReason } = params;
    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        this.logger.debug("SendMessageService flushed assistant buffer", {
          chatId,
          messageId: message.id,
          contentBlocks: message.contentBlocks.length,
          reasoningBlocks: message.reasoningBlocks?.length ?? 0,
          turnId,
        });
        await this.sessionRepo.appendMessage(chatId, session.userId, {
          id: message.id,
          role: "assistant",
          content: message.content,
          contentBlocks: message.contentBlocks,
          reasoning: message.reasoning,
          reasoningBlocks: message.reasoningBlocks,
          timestamp: Date.now(),
        });
      }
    }

    const current = session.uiState.currentAssistantId
      ? session.uiState.messages.get(session.uiState.currentAssistantId)
      : null;
    if (current) {
      finalizeStreamingParts(current);
      this.sessionRuntime.broadcast(chatId, {
        type: "ui_message",
        message: current,
      });
      this.logger.debug("SendMessageService finalized streaming message", {
        chatId,
        messageId: current.id,
        parts: current.parts.length,
        turnId,
      });
      session.uiState.currentAssistantId = undefined;
    }

    setChatFinishStopReason(session, stopReason, turnId);
    maybeBroadcastChatFinish({
      chatId,
      session,
      broadcast,
    });
    this.logger.debug("SendMessageService chat finish broadcast", {
      chatId,
      stopReason,
      turnId,
    });

    if (session.chatStatus === "submitted") {
      updateChatStatus({
        chatId,
        session,
        broadcast,
        status: "ready",
        turnId,
      });
      this.logger.debug("SendMessageService chat status ready", {
        chatId,
        turnId,
      });
    }

    if (session.activeTurnId === turnId) {
      session.activeTurnId = undefined;
    }
  }

  private async markSessionStopped(params: {
    chatId: string;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    reason: string;
    includeTurnId: boolean;
  }): Promise<void> {
    const { chatId, session, broadcast, turnId, reason, includeTurnId } =
      params;
    this.logger.warn("SendMessageService mark stopped", {
      chatId,
      reason,
      turnId,
    });
    this.sessionRuntime.broadcast(chatId, {
      type: "error",
      error: reason,
    });
    updateChatStatus({
      chatId,
      session,
      broadcast,
      status: "error",
      turnId: includeTurnId ? turnId : undefined,
    });
    await this.sessionRepo.updateStatus(chatId, session.userId, "stopped");
    session.activeTurnId = undefined;
    session.activePromptTask = undefined;
    if (!session.proc.killed) {
      session.proc.kill();
    }
    this.sessionRuntime.delete(chatId);
  }

  private assertInlineMediaPayloadBudget(input: SendMessageExecuteInput): void {
    const maxBytes = this.policy.messagePartsMaxBytes;
    let totalInlineMediaBytes = 0;

    const consume = (bytes: number, field: string, index: number) => {
      if (bytes > maxBytes) {
        throw new ValidationError(
          `${field}[${index}] payload exceeds max size: ${bytes} bytes > ${maxBytes}`,
          {
            module: "ai",
            op: OP,
            details: {
              chatId: input.chatId,
              field,
              index,
              payloadBytes: bytes,
              maxBytes,
            },
          }
        );
      }
      totalInlineMediaBytes += bytes;
      if (totalInlineMediaBytes > maxBytes) {
        throw new ValidationError(
          `Inline media payload exceeds max size: ${totalInlineMediaBytes} bytes > ${maxBytes}`,
          {
            module: "ai",
            op: OP,
            details: {
              chatId: input.chatId,
              totalInlineMediaBytes,
              maxBytes,
            },
          }
        );
      }
    };

    for (let i = 0; i < (input.images?.length ?? 0); i++) {
      const image = input.images?.[i];
      if (!image) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(
          input.chatId,
          "images",
          i,
          image.base64
        ),
        "images",
        i
      );
    }

    for (let i = 0; i < (input.audio?.length ?? 0); i++) {
      const clip = input.audio?.[i];
      if (!clip) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(input.chatId, "audio", i, clip.base64),
        "audio",
        i
      );
    }

    for (let i = 0; i < (input.resources?.length ?? 0); i++) {
      const resource = input.resources?.[i];
      if (!resource?.blob) {
        continue;
      }
      consume(
        this.estimateBase64DecodedBytes(
          input.chatId,
          "resources.blob",
          i,
          resource.blob
        ),
        "resources.blob",
        i
      );
    }
  }

  private estimateBase64DecodedBytes(
    chatId: string,
    field: string,
    index: number,
    rawBase64: string
  ): number {
    const normalized = rawBase64.replace(/\s+/g, "");
    if (!normalized) {
      throw new ValidationError(`${field}[${index}] base64 payload is empty`, {
        module: "ai",
        op: OP,
        details: { chatId, field, index },
      });
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(normalized, "base64");
    } catch {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload`,
        {
          module: "ai",
          op: OP,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
          },
        }
      );
    }
    const canonical = decoded.toString("base64");
    if (!canonical || canonical !== normalized) {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload`,
        {
          module: "ai",
          op: OP,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
          },
        }
      );
    }

    const decodedBytes = decoded.length;
    if (!Number.isFinite(decodedBytes) || decodedBytes < 0) {
      throw new ValidationError(
        `${field}[${index}] has invalid base64 payload size`,
        {
          module: "ai",
          op: OP,
          details: {
            chatId,
            field,
            index,
            base64Length: normalized.length,
            decodedBytes,
          },
        }
      );
    }
    return decodedBytes;
  }
}
