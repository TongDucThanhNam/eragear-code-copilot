/**
 * Send Message Service
 *
 * Handles sending user messages to the AI agent and processing the response.
 * Manages message persistence, broadcasting, and response handling.
 *
 * @module modules/ai/application/send-message.service
 */

import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
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

/**
 * SendMessageService
 *
 * Core service for sending user messages to an active session.
 * Handles message creation, persistence, broadcasting, and response processing.
 *
 * @example
 * ```typescript
 * const service = new SendMessageService(sessionRepo, sessionRuntime);
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

  /**
   * Creates a SendMessageService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
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
      size?: number | bigint;
      annotations?: Record<string, unknown>;
    }[];
  }) {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }
    const stdin = session.proc.stdin;
    if (
      !stdin ||
      stdin.destroyed ||
      !stdin.writable ||
      session.proc.killed ||
      session.proc.exitCode !== null
    ) {
      throw new Error("Session is not running");
    }
    if (session.conn.signal.aborted) {
      throw new Error("Session connection is closed");
    }

    const capabilities = session.promptCapabilities ?? {};
    if (input.images?.length && !capabilities.image) {
      throw new Error("Agent does not support image content");
    }
    if (input.audio?.length && !capabilities.audio) {
      throw new Error("Agent does not support audio content");
    }
    if (input.resources?.length && !capabilities.embeddedContext) {
      throw new Error("Agent does not support embedded context");
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
    this.sessionRepo.appendMessage(input.chatId, {
      id: msgId,
      role: "user",
      content: input.text,
      contentBlocks: storedPromptBlocks,
      parts: uiMessage.parts,
      timestamp: msgTimestamp,
    });
    session.uiState.messages.set(uiMessage.id, uiMessage);
    this.sessionRuntime.broadcast(input.chatId, {
      type: "ui_message",
      message: uiMessage,
    });

    const markStopped = (reason: string) => {
      this.sessionRuntime.broadcast(input.chatId, {
        type: "error",
        error: reason,
      });
      updateChatStatus({
        chatId: input.chatId,
        session,
        broadcast,
        status: "error",
      });
      this.sessionRepo.updateStatus(input.chatId, "stopped");
      if (!session.proc.killed) {
        session.proc.kill();
      }
      this.sessionRuntime.delete(input.chatId);
    };

    let res: { stopReason: string } | null = null;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        res = await session.conn.prompt({
          sessionId: session.sessionId,
          prompt,
        });
        break;
      } catch (error) {
        const errorText = getAcpErrorText(error);
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
          markStopped(errorText || "Agent process exited");
          throw new Error(errorText || "Agent process exited");
        }
        updateChatStatus({
          chatId: input.chatId,
          session,
          broadcast,
          status: "error",
        });
        throw new Error(errorText || "Failed to send message");
      }
    }
    if (!res) {
      updateChatStatus({
        chatId: input.chatId,
        session,
        broadcast,
        status: "error",
      });
      throw new Error("Failed to send message");
    }

    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        this.sessionRepo.appendMessage(input.chatId, {
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
      this.sessionRuntime.broadcast(input.chatId, {
        type: "ui_message",
        message: current,
      });
      session.uiState.currentAssistantId = undefined;
    }

    setChatFinishStopReason(session, res.stopReason);
    maybeBroadcastChatFinish({
      chatId: input.chatId,
      session,
      broadcast,
    });

    if (session.chatStatus === "submitted") {
      updateChatStatus({
        chatId: input.chatId,
        session,
        broadcast,
        status: "ready",
      });
    }

    return {
      stopReason: res.stopReason,
      finishReason: mapStopReasonToFinishReason(res.stopReason),
      assistantMessageId:
        session.uiState.lastAssistantId ?? session.uiState.currentAssistantId,
      userMessageId: msgId,
    };
  }
}
