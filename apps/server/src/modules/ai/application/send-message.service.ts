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
} from "../../../shared/types/ports";
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
   * @returns Object containing the stop reason from the agent
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

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msgTimestamp = Date.now();

    this.sessionRepo.appendMessage(input.chatId, {
      id: msgId,
      role: "user",
      content: input.text,
      timestamp: msgTimestamp,
    });

    this.sessionRuntime.broadcast(input.chatId, {
      type: "user_message",
      id: msgId,
      text: input.text,
      timestamp: msgTimestamp,
    });

    const prompt = buildPrompt({
      text: input.text,
      textAnnotations: input.textAnnotations,
      images: input.images,
      audio: input.audio,
      resources: input.resources,
      resourceLinks: input.resourceLinks,
    });

    const res = await session.conn.prompt({
      sessionId: session.sessionId,
      prompt,
    });

    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        this.sessionRepo.appendMessage(input.chatId, {
          id: message.id,
          role: "assistant",
          content: message.content,
          reasoning: message.reasoning,
          timestamp: Date.now(),
        });
      }
    }

    this.sessionRuntime.broadcast(input.chatId, {
      type: "session_update",
      update: { sessionUpdate: "prompt_end" },
    });

    return { stopReason: res.stopReason };
  }
}
