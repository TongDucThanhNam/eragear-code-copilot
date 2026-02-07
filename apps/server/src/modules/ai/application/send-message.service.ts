/**
 * Send Message Service
 *
 * Handles sending user messages to the AI agent and processing the response.
 * Manages message persistence, broadcasting, and response handling.
 *
 * @module modules/ai/application/send-message.service
 */

import { ENV } from "@/config/environment";
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
import {
  buildUserMessageFromBlocks,
  finalizeStreamingParts,
} from "../../../shared/utils/ui-message.util";
import {
  getAcpErrorText,
  isProcessExited,
  isProcessTransportNotReady,
} from "./acp-error.util";
import { buildPrompt } from "./prompt.builder";

const OP = "ai.prompt.send";

/**
 * SendMessageService
 *
 * Core service for sending user messages to an active session.
 * Handles message creation, persistence, broadcasting, and response processing.
 *
 * @example
 * ```typescript
 * const service = new SendMessageService(sessionRepo, sessionRuntime, logger);
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

  /**
   * Creates a SendMessageService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    logger: LoggerPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.logger = logger;
  }

  /**
   * Sends a message to the agent and handles the response
   *
   * @param input - Message input parameters
   * @returns Object containing the stop reason and related metadata
   * @throws Error if session is not found or not running
   */
  async execute(input: {
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
  }): Promise<{
    status: "submitted" | "completed";
    stopReason: string;
    finishReason: string;
    assistantMessageId?: string;
    userMessageId: string;
    submittedAt: number;
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
    if (textBytes > ENV.messageContentMaxBytes) {
      throw new ValidationError(
        `Prompt text exceeds max size: ${textBytes} bytes > ${ENV.messageContentMaxBytes}`,
        {
          module: "ai",
          op: OP,
          details: { chatId: input.chatId, textBytes },
        }
      );
    }
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

    const broadcast = this.sessionRuntime.broadcast.bind(this.sessionRuntime);
    updateChatStatus({
      chatId: input.chatId,
      session,
      broadcast,
      status: "submitted",
    });
    session.chatFinish = undefined;
    session.uiState.lastAssistantId = undefined;
    this.logger.debug("SendMessageService chat status submitted", {
      chatId: input.chatId,
      sessionId: session.sessionId,
    });

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    await this.sessionRepo.appendMessage(input.chatId, {
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

    const promptTask = this.handlePrompt({
      chatId: input.chatId,
      session,
      prompt,
      broadcast,
    });

    const ackTimeoutMs = 250;
    const outcome = await Promise.race([
      promptTask.then((result) => ({ type: "result" as const, result })),
      new Promise<{ type: "ack" }>((resolve) =>
        setTimeout(() => resolve({ type: "ack" }), ackTimeoutMs)
      ),
    ]);

    if (outcome.type === "result") {
      this.logger.debug("SendMessageService prompt completed inline", {
        chatId: input.chatId,
        stopReason: outcome.result.stopReason,
      });
      return {
        status: "completed",
        ...outcome.result,
        userMessageId: msgId,
        submittedAt: msgTimestamp,
      };
    }

    // Prompt is still running; return an acknowledgement and rely on chat_finish
    // for the final stopReason.
    this.logger.debug("SendMessageService prompt still running", {
      chatId: input.chatId,
      ackTimeoutMs,
    });
    promptTask.catch(() => {
      // Errors are handled via status updates/broadcasts inside handlePrompt.
    });

    return {
      status: "submitted",
      stopReason: "submitted",
      finishReason: mapStopReasonToFinishReason("submitted"),
      assistantMessageId:
        session.uiState.lastAssistantId ?? session.uiState.currentAssistantId,
      userMessageId: msgId,
      submittedAt: msgTimestamp,
    };
  }

  private async handlePrompt(params: {
    chatId: string;
    session: ChatSession;
    prompt: ReturnType<typeof buildPrompt>;
    broadcast: SessionRuntimePort["broadcast"];
  }): Promise<{
    stopReason: string;
    finishReason: string;
    assistantMessageId?: string;
  }> {
    const { chatId, session, prompt, broadcast } = params;

    const markStopped = async (reason: string) => {
      this.logger.warn("SendMessageService mark stopped", {
        chatId,
        reason,
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
      });
      await this.sessionRepo.updateStatus(chatId, "stopped");
      if (!session.proc.killed) {
        session.proc.kill();
      }
      this.sessionRuntime.delete(chatId);
    };

    let res: { stopReason: string } | null = null;
    const maxAttempts = 3;
    const sessionId = session.sessionId;
    if (!sessionId) {
      await markStopped("Session is missing ACP session id");
      throw new AppError({
        message: "Session is missing ACP session id",
        code: "SESSION_MISSING_ID",
        statusCode: 500,
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.logger.debug("SendMessageService sending prompt", {
          chatId,
          sessionId,
          attempt: attempt + 1,
          maxAttempts,
        });
        res = await session.conn.prompt({
          sessionId,
          prompt,
        });
        this.logger.debug("SendMessageService prompt response", {
          chatId,
          stopReason: res.stopReason,
        });
        break;
      } catch (error) {
        const errorText = getAcpErrorText(error);
        this.logger.warn("SendMessageService prompt error", {
          chatId,
          attempt: attempt + 1,
          maxAttempts,
          error: errorText || "unknown",
        });
        if (
          isProcessTransportNotReady(errorText) &&
          attempt < maxAttempts - 1
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, 150 * (attempt + 1))
          );
          continue;
        }
        if (isProcessExited(errorText)) {
          await markStopped(errorText || "Agent process exited");
          throw new AppError({
            message: errorText || "Agent process exited",
            code: "AGENT_PROCESS_EXITED",
            statusCode: 503,
            module: "ai",
            op: OP,
            details: { chatId },
          });
        }
        updateChatStatus({
          chatId,
          session,
          broadcast,
          status: "error",
        });
        throw new AppError({
          message: errorText || "Failed to send message",
          code: "SEND_MESSAGE_FAILED",
          statusCode: 502,
          module: "ai",
          op: OP,
          cause: error,
          details: { chatId },
        });
      }
    }
    if (!res) {
      this.logger.warn("SendMessageService failed to get prompt response", {
        chatId,
        attempts: maxAttempts,
      });
      updateChatStatus({
        chatId,
        session,
        broadcast,
        status: "error",
      });
      throw new AppError({
        message: "Failed to send message",
        code: "SEND_MESSAGE_FAILED",
        statusCode: 502,
        module: "ai",
        op: OP,
        details: { chatId },
      });
    }

    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        this.logger.debug("SendMessageService flushed assistant buffer", {
          chatId,
          messageId: message.id,
          contentBlocks: message.contentBlocks.length,
          reasoningBlocks: message.reasoningBlocks?.length ?? 0,
        });
        await this.sessionRepo.appendMessage(chatId, {
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
      });
      session.uiState.currentAssistantId = undefined;
    }

    setChatFinishStopReason(session, res.stopReason);
    maybeBroadcastChatFinish({
      chatId,
      session,
      broadcast,
    });
    this.logger.debug("SendMessageService chat finish broadcast", {
      chatId,
      stopReason: res.stopReason,
    });

    if (session.chatStatus === "submitted") {
      updateChatStatus({
        chatId,
        session,
        broadcast,
        status: "ready",
      });
      this.logger.debug("SendMessageService chat status ready", {
        chatId,
      });
    }

    return {
      stopReason: res.stopReason,
      finishReason: mapStopReasonToFinishReason(res.stopReason),
      assistantMessageId:
        session.uiState.lastAssistantId ?? session.uiState.currentAssistantId,
    };
  }
}
