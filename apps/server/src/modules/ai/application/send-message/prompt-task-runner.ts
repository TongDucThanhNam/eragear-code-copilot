import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { AppError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import {
  maybeBroadcastChatFinish,
  setChatFinishStopReason,
  updateChatStatus,
} from "@/shared/utils/chat-events.util";
import { finalizeStreamingParts } from "@/shared/utils/ui-message.util";
import { classifyAcpError, getAcpErrorText } from "../acp-error.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "../acp-retry-policy";
import { AI_OP, HTTP_STATUS } from "../ai.constants";

interface PromptTaskRunnerPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface PromptTaskRunnerDeps {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  logger: LoggerPort;
  clock: ClockPort;
  policy: PromptTaskRunnerPolicy;
}

interface PromptTaskParams {
  chatId: string;
  session: ChatSession;
  prompt: ContentBlock[];
  broadcast: SessionRuntimePort["broadcast"];
  turnId: string;
}

interface MarkStoppedParams {
  chatId: string;
  session: ChatSession;
  broadcast: SessionRuntimePort["broadcast"];
  turnId: string;
  reason: string;
  includeTurnId: boolean;
  killProcess: boolean;
}

export class PromptTaskRunner {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly policy: PromptTaskRunnerPolicy;

  constructor(deps: PromptTaskRunnerDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
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
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
  }): Promise<void> {
    const { chatId, session, broadcast } = params;
    const activePromptTask = session.activePromptTask;
    if (!(activePromptTask && session.sessionId)) {
      return;
    }

    try {
      await session.conn.cancel({ sessionId: session.sessionId });
    } catch (error) {
      const classified = classifyAcpError(error);
      const reason = classified.text || "Failed to cancel active prompt turn";
      if (
        classified.kind === "fatal_process" ||
        classified.kind === "fatal_session"
      ) {
        await this.markSessionStopped({
          chatId,
          session,
          broadcast,
          turnId: activePromptTask.turnId,
          reason,
          includeTurnId: false,
          killProcess: classified.kind === "fatal_process",
        });
        throw new AppError({
          message: reason,
          code:
            classified.kind === "fatal_process"
              ? "AGENT_PROCESS_EXITED"
              : "SESSION_CONNECTION_CLOSED",
          statusCode:
            classified.kind === "fatal_process"
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
    const { chatId, session, turnId, broadcast } = params;
    try {
      await this.handlePrompt(params);
    } catch (error) {
      const classified = classifyAcpError(error);
      if (
        classified.kind === "fatal_process" ||
        classified.kind === "fatal_session"
      ) {
        const isCurrentTurn = session.activeTurnId === turnId;
        await this.markSessionStopped({
          chatId,
          session,
          broadcast,
          turnId,
          reason: classified.text || "Prompt task failed",
          includeTurnId: isCurrentTurn,
          killProcess: classified.kind === "fatal_process",
        });
        return;
      }

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

  private async handlePrompt(params: PromptTaskParams): Promise<void> {
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
        killProcess: false,
      });
      return;
    }

    const response = await this.requestPromptWithRetries({
      chatId,
      session,
      sessionId,
      prompt,
      broadcast,
      turnId,
      isCurrentTurn,
    });
    if (!response) {
      return;
    }

    if (!isCurrentTurn()) {
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
      session,
      broadcast,
      turnId,
      stopReason: response.stopReason,
    });
  }

  private async requestPromptWithRetries(params: {
    chatId: string;
    session: ChatSession;
    sessionId: string;
    prompt: ContentBlock[];
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

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
        const classified = classifyAcpError(error);
        const errorText = classified.text;
        this.logger.warn("SendMessageService prompt error", {
          chatId,
          attempt: attempt + 1,
          maxAttempts,
          error: errorText || "unknown",
          turnId,
          kind: classified.kind,
        });

        if (
          classified.kind === "retryable_transport" &&
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

        if (
          classified.kind === "fatal_process" ||
          classified.kind === "fatal_session"
        ) {
          await this.markSessionStopped({
            chatId,
            session,
            broadcast,
            turnId,
            reason:
              errorText ||
              (classified.kind === "fatal_process"
                ? "Agent process exited"
                : "Agent session is unavailable"),
            includeTurnId: isCurrentTurn(),
            killProcess: classified.kind === "fatal_process",
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
          statusCode: HTTP_STATUS.BAD_GATEWAY,
          module: "ai",
          op: AI_OP.PROMPT_SEND,
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
      statusCode: HTTP_STATUS.BAD_GATEWAY,
      module: "ai",
      op: AI_OP.PROMPT_SEND,
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
          timestamp: this.clock.nowMs(),
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

  private async markSessionStopped(params: MarkStoppedParams): Promise<void> {
    const {
      chatId,
      session,
      broadcast,
      turnId,
      reason,
      includeTurnId,
      killProcess,
    } = params;
    this.logger.warn("SendMessageService mark stopped", {
      chatId,
      reason,
      turnId,
      killProcess,
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
    if (killProcess && !session.proc.killed) {
      session.proc.kill();
    }
    this.sessionRuntime.delete(chatId);
  }
}
