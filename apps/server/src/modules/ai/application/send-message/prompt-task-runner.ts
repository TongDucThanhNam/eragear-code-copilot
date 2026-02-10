import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { AppError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { mapStopReasonToFinishReason } from "@/shared/utils/chat-events.util";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import {
  AI_CHAT_STATUS,
  type AiChatSessionAggregate,
} from "../../domain/ai-chat-session.aggregate";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "../acp-retry-policy";
import { AI_OP, HTTP_STATUS } from "../ai.constants";
import type { AiSessionRuntimePort } from "../ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "../ports/ai-session-runtime.port";

interface PromptTaskRunnerPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface PromptTaskRunnerDeps {
  sessionRepo: SessionRepositoryPort;
  sessionGateway: AiSessionRuntimePort;
  logger: LoggerPort;
  clock: ClockPort;
  policy: PromptTaskRunnerPolicy;
}

interface PromptTaskParams {
  chatId: string;
  aggregate: AiChatSessionAggregate;
  prompt: ContentBlock[];
  broadcast: SessionRuntimePort["broadcast"];
  turnId: string;
}

export class PromptTaskRunner {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly policy: PromptTaskRunnerPolicy;

  constructor(deps: PromptTaskRunnerDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionGateway = deps.sessionGateway;
    this.logger = deps.logger;
    this.clock = deps.clock;
    this.policy = {
      acpRetryMaxAttempts: Math.max(
        1,
        Math.trunc(deps.policy.acpRetryMaxAttempts)
      ),
      acpRetryBaseDelayMs: Math.max(
        1,
        Math.trunc(deps.policy.acpRetryBaseDelayMs)
      ),
    };
  }

  async cancelActivePrompt(params: {
    chatId: string;
    aggregate: AiChatSessionAggregate;
    broadcast: SessionRuntimePort["broadcast"];
  }): Promise<void> {
    const { chatId, aggregate } = params;
    const session = aggregate.raw;
    const activePromptTask = aggregate.activePromptTask;
    if (!(activePromptTask && session.sessionId)) {
      return;
    }

    try {
      await this.sessionGateway.cancelPrompt(session);
    } catch (error) {
      const reason = getRuntimeErrorText(
        error,
        "Failed to cancel active prompt turn"
      );
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        await this.sessionGateway.stopAndCleanup({
          chatId,
          session,
          turnId: activePromptTask.turnId,
          reason,
          killProcess: error.kind === "process_exited",
        });
        throw new AppError({
          message: reason,
          code:
            error.kind === "process_exited"
              ? "AGENT_PROCESS_EXITED"
              : "SESSION_CONNECTION_CLOSED",
          statusCode:
            error.kind === "process_exited"
              ? HTTP_STATUS.SERVICE_UNAVAILABLE
              : HTTP_STATUS.CONFLICT,
          module: "ai",
          op: AI_OP.PROMPT_SEND,
          details: { chatId, turnId: activePromptTask.turnId },
          cause: error,
        });
      }

      this.logger.warn("SendMessageService prompt cancel failed; continuing", {
        chatId,
        turnId: activePromptTask.turnId,
        error: reason,
      });
    }
  }

  async runPromptTask(params: PromptTaskParams): Promise<void> {
    const { chatId, aggregate, turnId, broadcast } = params;
    const session = aggregate.raw;
    try {
      await this.handlePrompt(params);
    } catch (error) {
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        const reason = error.message || "Prompt task failed";
        await this.sessionGateway.stopAndCleanup({
          chatId,
          session,
          turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
          reason,
          killProcess: error.kind === "process_exited",
        });
        return;
      }

      const normalizedError = getRuntimeErrorText(
        error,
        "Unexpected prompt failure"
      );
      this.logger.error("SendMessageService prompt task crashed", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        error: normalizedError,
      });

      if (aggregate.isCurrentTurn(turnId)) {
        aggregate.markError({ chatId, broadcast }, turnId);
        aggregate.clearActiveTurnIf(turnId);
        broadcast(chatId, {
          type: "error",
          error: normalizedError,
        });
      }
    } finally {
      aggregate.clearActivePromptTaskIf(turnId);
    }
  }

  private async handlePrompt(params: PromptTaskParams): Promise<void> {
    const { chatId, aggregate, prompt, broadcast, turnId } = params;
    const session = aggregate.raw;
    if (!session.sessionId) {
      await this.sessionGateway.stopAndCleanup({
        chatId,
        session,
        turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
        reason: "Session is missing ACP session id",
        killProcess: false,
      });
      return;
    }

    const response = await this.requestPromptWithRetries({
      chatId,
      aggregate,
      session,
      prompt,
      broadcast,
      turnId,
    });
    if (!response) {
      return;
    }

    if (!aggregate.isCurrentTurn(turnId)) {
      this.logger.warn("SendMessageService ignoring stale prompt completion", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        stopReason: response.stopReason,
      });
      return;
    }

    await this.finalizePromptSuccess({
      chatId,
      aggregate,
      session,
      broadcast,
      turnId,
      stopReason: response.stopReason,
    });
  }

  private async requestPromptWithRetries(params: {
    chatId: string;
    aggregate: AiChatSessionAggregate;
    session: ChatSession;
    prompt: ContentBlock[];
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
  }): Promise<{ stopReason: string } | null> {
    const { chatId, aggregate, session, prompt, broadcast, turnId } = params;
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        this.logger.debug("SendMessageService sending prompt", {
          chatId,
          sessionId: session.sessionId,
          attempt: attempt + 1,
          maxAttempts,
          turnId,
        });
        const response = await this.sessionGateway.prompt(session, prompt);
        this.logger.debug("SendMessageService prompt response", {
          chatId,
          stopReason: response.stopReason,
          turnId,
        });
        return response;
      } catch (error) {
        const outcome = await this.handlePromptRequestFailure({
          error,
          attempt,
          maxAttempts,
          retryBaseDelayMs,
          chatId,
          aggregate,
          session,
          broadcast,
          turnId,
        });
        if (outcome === "retry") {
          continue;
        }
        if (outcome === "return_null") {
          return null;
        }
      }
    }

    return this.handlePromptExhausted({
      chatId,
      aggregate,
      session,
      broadcast,
      turnId,
      maxAttempts,
    });
  }

  private async handlePromptRequestFailure(params: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    chatId: string;
    aggregate: AiChatSessionAggregate;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
  }): Promise<"retry" | "return_null"> {
    const {
      error,
      attempt,
      maxAttempts,
      retryBaseDelayMs,
      chatId,
      aggregate,
      session,
      broadcast,
      turnId,
    } = params;
    const errorText = getRuntimeErrorText(error, "unknown");
    const errorKind =
      error instanceof AiSessionRuntimeError ? error.kind : "unknown";
    this.logger.warn("SendMessageService prompt error", {
      chatId,
      attempt: attempt + 1,
      maxAttempts,
      error: errorText,
      turnId,
      kind: errorKind,
    });

    if (
      error instanceof AiSessionRuntimeError &&
      error.kind === "retryable_transport" &&
      attempt < maxAttempts - 1
    ) {
      await new Promise((resolve) => {
        setTimeout(resolve, getAcpRetryDelayMs(attempt + 1, retryBaseDelayMs));
      });
      return "retry";
    }

    if (
      error instanceof AiSessionRuntimeError &&
      (error.kind === "process_exited" || error.kind === "session_unavailable")
    ) {
      await this.sessionGateway.stopAndCleanup({
        chatId,
        session,
        turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
        reason:
          error.message ||
          (error.kind === "process_exited"
            ? "Agent process exited"
            : "Agent session is unavailable"),
        killProcess: error.kind === "process_exited",
      });
      return "return_null";
    }

    if (!aggregate.isCurrentTurn(turnId)) {
      this.logger.warn("SendMessageService ignoring stale prompt error", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        error: errorText,
      });
      return "return_null";
    }

    aggregate.markError({ chatId, broadcast }, turnId);
    aggregate.clearActiveTurnIf(turnId);
    throw new AppError({
      message: errorText || "Failed to send message",
      code: "SEND_MESSAGE_FAILED",
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: AI_OP.PROMPT_SEND,
      cause: error,
      details: { chatId, turnId },
    });
  }

  private handlePromptExhausted(params: {
    chatId: string;
    aggregate: AiChatSessionAggregate;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    maxAttempts: number;
  }): null {
    const { chatId, aggregate, session, broadcast, turnId, maxAttempts } =
      params;
    this.logger.warn("SendMessageService failed to get prompt response", {
      chatId,
      attempts: maxAttempts,
      turnId,
    });
    if (!aggregate.isCurrentTurn(turnId)) {
      this.logger.warn("SendMessageService stale turn without response", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
      });
      return null;
    }

    aggregate.markError({ chatId, broadcast }, turnId);
    aggregate.clearActiveTurnIf(turnId);
    throw new AppError({
      message: "Failed to send message",
      code: "SEND_MESSAGE_FAILED",
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: AI_OP.PROMPT_SEND,
      details: { chatId, turnId },
    });
  }

  private async finalizePromptSuccess(params: {
    chatId: string;
    aggregate: AiChatSessionAggregate;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    stopReason: string;
  }): Promise<void> {
    const { chatId, aggregate, session, broadcast, turnId, stopReason } =
      params;
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
          timestamp: this.clock.nowMs(),
        });
      }
    }

    const current = aggregate.currentStreamingAssistantMessage();
    if (current) {
      finalizeStreamingParts(current);
      broadcast(chatId, {
        type: "ui_message",
        message: current,
      });
      this.logger.debug("SendMessageService finalized streaming message", {
        chatId,
        messageId: current.id,
        parts: current.parts.length,
        turnId,
      });
      aggregate.clearCurrentStreamingAssistantId();
    }

    aggregate.setChatFinishStopReason(stopReason, turnId);
    aggregate.maybeBroadcastChatFinish({
      chatId,
      broadcast,
    });
    this.logger.debug("SendMessageService chat finish broadcast", {
      chatId,
      stopReason,
      finishReason: mapStopReasonToFinishReason(stopReason),
      turnId,
    });

    aggregate.markReadyIfSubmitted({ chatId, broadcast }, turnId);
    if (session.chatStatus === AI_CHAT_STATUS.READY) {
      this.logger.debug("SendMessageService chat status ready", {
        chatId,
        turnId,
      });
    }
    aggregate.clearActiveTurnIf(turnId);
  }
}

function getRuntimeErrorText(error: unknown, fallback: string): string {
  if (error instanceof AiSessionRuntimeError) {
    return error.message || fallback;
  }
  if (error instanceof AppError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}
