import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import {
  SESSION_RUNTIME_CHAT_STATUS,
  type SessionRuntimeEntity,
} from "@/modules/session/domain/session-runtime.entity";
import { AppError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import {
  buildChatFinishEvent,
  mapStopReasonToFinishReason,
  setChatFinishMessage,
} from "@/shared/utils/chat-events.util";
import { createId } from "@/shared/utils/id.util";
import {
  appendReasoningBlock,
  buildAssistantMessageFromBlocks,
  finalizeStreamingParts,
  getOrCreateAssistantMessage,
} from "@/shared/utils/ui-message.util";
import { buildUiMessagePartEvent } from "@/shared/utils/ui-message-part-event.util";
import { getAcpRetryDelayMs, getAcpRetryPolicy } from "../acp-retry-policy";
import { AI_OP, HTTP_STATUS } from "../ai.constants";
import type { AiSessionRuntimePort } from "../ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "../ports/ai-session-runtime.port";

/** Warn when prompt has been submitted but no ACP chunk arrived in time. */
const ACP_STREAM_WATCHDOG_MS = 5000;
const ACP_ASSISTANT_DRAIN_IDLE_MS = 150;
const ACP_ASSISTANT_DRAIN_MAX_WAIT_MS = 1500;

interface PromptTaskRunnerPolicy {
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

interface PromptRuntimePolicy {
  maxTokens: number;
}

interface PromptTaskRunnerDeps {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  sessionGateway: AiSessionRuntimePort;
  logger: LoggerPort;
  clock: ClockPort;
  policy: PromptTaskRunnerPolicy;
  runtimePolicyProvider: () => PromptRuntimePolicy;
  afterTurnComplete?: (event: PromptTurnCompleteEvent) => void | Promise<void>;
}

interface PromptTaskParams {
  chatId: string;
  aggregate: SessionRuntimeEntity;
  prompt: ContentBlock[];
  broadcast: SessionRuntimePort["broadcast"];
  turnId: string;
  source: "client" | "supervisor";
  abortSignal?: AbortSignal;
}

export interface PromptTurnCompleteEvent {
  chatId: string;
  userId: string;
  turnId: string;
  stopReason: string;
  source: "client" | "supervisor";
}

export class PromptTaskRunner {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionGateway: AiSessionRuntimePort;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly policy: PromptTaskRunnerPolicy;
  private readonly runtimePolicyProvider: () => PromptRuntimePolicy;
  private afterTurnComplete?: (
    event: PromptTurnCompleteEvent
  ) => void | Promise<void>;

  constructor(deps: PromptTaskRunnerDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
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
    this.runtimePolicyProvider = deps.runtimePolicyProvider;
    this.afterTurnComplete = deps.afterTurnComplete;
  }

  setAfterTurnCompleteHook(
    hook: (event: PromptTurnCompleteEvent) => void | Promise<void>
  ): void {
    this.afterTurnComplete = hook;
  }

  async cancelActivePrompt(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
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
    let completedStopReason: string | undefined;
    try {
      completedStopReason = await this.handlePrompt(params);
    } catch (error) {
      if (
        error instanceof AiSessionRuntimeError &&
        (error.kind === "process_exited" ||
          error.kind === "session_unavailable")
      ) {
        const reason = error.message || "Prompt task failed";
        const fallbackMessageId = await this.persistAssistantFallbackMessage({
          chatId,
          aggregate,
          turnId,
          broadcast,
          errorMessage: reason,
        });
        if (fallbackMessageId) {
          session.uiState.lastAssistantId = fallbackMessageId;
        }
        await this.finalizeCurrentTurnArtifacts({
          chatId,
          aggregate,
          turnId,
          broadcast,
          session,
        });
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
      await this.persistAssistantFallbackMessage({
        chatId,
        aggregate,
        turnId,
        broadcast,
        errorMessage: normalizedError,
      });
      this.logger.error("SendMessageService prompt task crashed", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        error: normalizedError,
      });
      await this.finalizeCurrentTurnArtifacts({
        chatId,
        aggregate,
        turnId,
        broadcast,
        session,
      });
      await this.sessionGateway.stopAndCleanup({
        chatId,
        session,
        turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
        reason: normalizedError,
        killProcess: true,
      });
    } finally {
      aggregate.clearActivePromptTaskIf(turnId);
      await this.notifyAfterTurnComplete({
        chatId,
        session,
        turnId,
        source: params.source,
        stopReason: completedStopReason,
      });
    }
  }

  private async notifyAfterTurnComplete(params: {
    chatId: string;
    session: ChatSession;
    turnId: string;
    source: "client" | "supervisor";
    stopReason?: string;
  }): Promise<void> {
    const { chatId, session, turnId, source } = params;
    if (!this.afterTurnComplete) {
      return;
    }
    const stopReason =
      params.stopReason ??
      (session.chatFinish?.turnId === turnId
        ? session.chatFinish.stopReason
        : undefined);
    if (!stopReason) {
      return;
    }
    await this.afterTurnComplete({
      chatId,
      userId: session.userId,
      turnId,
      stopReason,
      source,
    });
  }

  private async persistAssistantFallbackMessage(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    turnId: string;
    broadcast: SessionRuntimePort["broadcast"];
    errorMessage: string;
  }): Promise<string | undefined> {
    const { chatId, aggregate, turnId, broadcast, errorMessage } = params;
    if (!aggregate.isCurrentTurn(turnId)) {
      return undefined;
    }
    if (aggregate.assistantMessageId) {
      return aggregate.assistantMessageId;
    }

    const session = aggregate.raw;
    const messageId = createId("msg");
    const contentBlocks = [
      {
        type: "text",
        text: errorMessage,
      } as const,
    ];
    const createdAt = this.clock.nowMs();
    const uiMessage = buildAssistantMessageFromBlocks({
      messageId,
      contentBlocks,
      createdAt,
    });

    try {
      await this.sessionRepo.appendMessage(chatId, session.userId, {
        id: messageId,
        role: "assistant",
        content: errorMessage,
        contentBlocks,
        parts: uiMessage.parts,
        timestamp: createdAt,
      });
      session.uiState.messages.set(uiMessage.id, uiMessage);
      session.uiState.lastAssistantId = uiMessage.id;
      await broadcast(chatId, {
        type: "ui_message",
        message: uiMessage,
        turnId,
      });
      return uiMessage.id;
    } catch (persistError) {
      this.logger.warn("Failed to persist fallback assistant error message", {
        chatId,
        turnId,
        error:
          persistError instanceof Error
            ? persistError.message
            : String(persistError),
      });
      return aggregate.assistantMessageId;
    }
  }

  private async handlePrompt(
    params: PromptTaskParams
  ): Promise<string | undefined> {
    const { chatId, aggregate, prompt, broadcast, turnId, abortSignal } =
      params;
    const session = aggregate.raw;
    if (!session.sessionId) {
      await this.sessionGateway.stopAndCleanup({
        chatId,
        session,
        turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
        reason: "Session is missing ACP session id",
        killProcess: false,
      });
      return undefined;
    }

    const response = await this.requestPromptWithRetries({
      chatId,
      aggregate,
      session,
      prompt,
      broadcast,
      turnId,
      abortSignal,
    });
    if (!response) {
      return undefined;
    }

    if (!aggregate.isCurrentTurn(turnId)) {
      this.logger.warn("SendMessageService ignoring stale prompt completion", {
        chatId,
        turnId,
        activeTurnId: session.activeTurnId,
        stopReason: response.stopReason,
      });
      return undefined;
    }

    await this.waitForAssistantDrain({
      chatId,
      aggregate,
      session,
      turnId,
    });

    await this.finalizePromptSuccess({
      chatId,
      aggregate,
      session,
      broadcast,
      turnId,
      stopReason: response.stopReason,
    });
    return response.stopReason;
  }

  private async requestPromptWithRetries(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    prompt: ContentBlock[];
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    abortSignal?: AbortSignal;
  }): Promise<{ stopReason: string } | null> {
    const {
      chatId,
      aggregate,
      session,
      prompt,
      broadcast,
      turnId,
      abortSignal,
    } = params;
    const { maxAttempts, retryBaseDelayMs } = getAcpRetryPolicy({
      maxAttempts: this.policy.acpRetryMaxAttempts,
      retryBaseDelayMs: this.policy.acpRetryBaseDelayMs,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!aggregate.isCurrentTurn(turnId)) {
        this.logger.warn("SendMessageService skipping stale prompt retry", {
          chatId,
          turnId,
          activeTurnId: session.activeTurnId,
          attempt: attempt + 1,
          maxAttempts,
        });
        return null;
      }
      if (abortSignal?.aborted) {
        await this.handlePromptAborted({
          chatId,
          aggregate,
          session,
          broadcast,
          turnId,
          reason: getAbortReasonText(abortSignal.reason),
        });
        return null;
      }
      try {
        this.logger.debug("SendMessageService sending prompt", {
          chatId,
          sessionId: session.sessionId,
          attempt: attempt + 1,
          maxAttempts,
          turnId,
          maxTokens: this.runtimePolicyProvider().maxTokens,
        });
        const watchdogStartedAt = this.clock.nowMs();
        const watchdog = setTimeout(() => {
          if (!aggregate.isCurrentTurn(turnId)) {
            return;
          }
          if (session.buffer?.hasContent()) {
            return;
          }
          this.logger.warn(
            "Prompt streaming watchdog: no ACP chunks observed",
            {
              chatId,
              turnId,
              waitMs: this.clock.nowMs() - watchdogStartedAt,
              attempt: attempt + 1,
              maxAttempts,
              sessionId: session.sessionId,
              processPid: session.proc.pid ?? null,
              chatStatus: session.chatStatus,
              activeTurnId: session.activeTurnId ?? null,
              activePromptTurnId: session.activePromptTask?.turnId ?? null,
              subscriberCount: session.subscriberCount,
              emitterSubscriberCount: session.emitter.listenerCount("data"),
              hasBufferedContent: session.buffer?.hasContent() ?? false,
              bufferMessageId: session.buffer?.getMessageId() ?? null,
              currentAssistantMessageId:
                session.uiState.currentAssistantId ?? null,
              lastAssistantMessageId: session.uiState.lastAssistantId ?? null,
              isReplayingHistory: session.isReplayingHistory,
              suppressReplayBroadcast: session.suppressReplayBroadcast,
              sessionLoadMethod: session.sessionLoadMethod,
            }
          );
        }, ACP_STREAM_WATCHDOG_MS);
        watchdog.unref?.();
        let response: { stopReason: string };
        try {
          response = await this.sessionGateway.prompt(session, prompt, {
            maxTokens: this.runtimePolicyProvider().maxTokens,
            signal: abortSignal,
          });
        } finally {
          clearTimeout(watchdog);
        }
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
          abortSignal,
        });
        if (outcome === "retry") {
          continue;
        }
        if (outcome === "return_null") {
          return null;
        }
      }
    }

    return await this.handlePromptExhausted({
      chatId,
      aggregate,
      session,
      broadcast,
      turnId,
      maxAttempts,
    });
  }

  private async waitForAssistantDrain(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    turnId: string;
  }): Promise<void> {
    const { chatId, aggregate, session, turnId } = params;
    const startedAt = this.clock.nowMs();
    let yieldedForTrailingEvents = false;

    while (aggregate.isCurrentTurn(turnId)) {
      const now = this.clock.nowMs();
      const sameTurnActivityAt =
        session.lastAssistantActivityTurnId === turnId
          ? session.lastAssistantActivityAtMs
          : undefined;
      const hasBufferedAssistantState = Boolean(
        session.buffer?.hasContent() ||
          session.uiState.currentAssistantId ||
          session.lastAssistantChunkType
      );
      const idleMs =
        typeof sameTurnActivityAt === "number"
          ? now - sameTurnActivityAt
          : now - startedAt;
      const waitedMs = now - startedAt;
      const maxWaitElapsed = waitedMs >= ACP_ASSISTANT_DRAIN_MAX_WAIT_MS;

      if (typeof sameTurnActivityAt === "number") {
        if (idleMs >= ACP_ASSISTANT_DRAIN_IDLE_MS) {
          this.logger.debug("SendMessageService assistant stream drained", {
            chatId,
            turnId,
            waitedMs,
            idleMs,
            lastAssistantActivityAtMs: sameTurnActivityAt,
          });
          return;
        }
      } else if (hasBufferedAssistantState) {
        return;
      } else if (!hasBufferedAssistantState) {
        if (!yieldedForTrailingEvents) {
          yieldedForTrailingEvents = true;
          await new Promise((resolve) => {
            queueMicrotask(resolve);
          });
          continue;
        }
        return;
      }

      if (maxWaitElapsed) {
        this.logger.warn("SendMessageService assistant drain timed out", {
          chatId,
          turnId,
          waitedMs,
          idleMs,
          hasBufferedAssistantState,
          lastAssistantActivityAtMs: sameTurnActivityAt ?? null,
          lastAssistantActivityTurnId:
            session.lastAssistantActivityTurnId ?? null,
          currentAssistantMessageId: session.uiState.currentAssistantId ?? null,
          bufferHasContent: session.buffer?.hasContent() ?? false,
          lastAssistantChunkType: session.lastAssistantChunkType ?? null,
        });
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Refactoring would require significant interface changes
  private async handlePromptRequestFailure(params: {
    error: unknown;
    attempt: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    abortSignal?: AbortSignal;
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
      abortSignal,
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

    if (error instanceof AiSessionRuntimeError && error.kind === "cancelled") {
      await this.handlePromptAborted({
        chatId,
        aggregate,
        session,
        broadcast,
        turnId,
        reason: error.message,
      });
      return "return_null";
    }

    if (
      error instanceof AiSessionRuntimeError &&
      error.kind === "retryable_transport" &&
      attempt < maxAttempts - 1
    ) {
      if (abortSignal?.aborted) {
        await this.handlePromptAborted({
          chatId,
          aggregate,
          session,
          broadcast,
          turnId,
          reason: getAbortReasonText(abortSignal.reason),
        });
        return "return_null";
      }
      if (!aggregate.isCurrentTurn(turnId)) {
        this.logger.warn(
          "SendMessageService stale turn before retry delay; skipping retry",
          {
            chatId,
            turnId,
            activeTurnId: session.activeTurnId,
            attempt: attempt + 1,
            maxAttempts,
          }
        );
        return "return_null";
      }
      await new Promise((resolve) => {
        setTimeout(resolve, getAcpRetryDelayMs(attempt + 1, retryBaseDelayMs));
      });
      if (abortSignal?.aborted) {
        await this.handlePromptAborted({
          chatId,
          aggregate,
          session,
          broadcast,
          turnId,
          reason: getAbortReasonText(abortSignal.reason),
        });
        return "return_null";
      }
      if (!aggregate.isCurrentTurn(turnId)) {
        this.logger.warn("SendMessageService stale turn after retry delay", {
          chatId,
          turnId,
          activeTurnId: session.activeTurnId,
          attempt: attempt + 1,
          maxAttempts,
        });
        return "return_null";
      }
      return "retry";
    }

    if (
      error instanceof AiSessionRuntimeError &&
      (error.kind === "process_exited" || error.kind === "session_unavailable")
    ) {
      await this.persistAssistantFallbackMessage({
        chatId,
        aggregate,
        turnId,
        broadcast,
        errorMessage:
          error.message ||
          (error.kind === "process_exited"
            ? "Agent process exited"
            : "Agent session is unavailable"),
      });
      await this.finalizeCurrentTurnArtifacts({
        chatId,
        aggregate,
        turnId,
        broadcast,
        session,
      });
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

    await this.persistAssistantFallbackMessage({
      chatId,
      aggregate,
      turnId,
      broadcast,
      errorMessage: errorText || "Failed to send message",
    });
    await this.finalizeTurnReadyAfterError({
      chatId,
      aggregate,
      turnId,
      broadcast,
      session,
      errorMessage: errorText || "Failed to send message",
    });
    return "return_null";
  }

  private async finalizeCurrentTurnArtifacts(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    turnId: string;
    broadcast: SessionRuntimePort["broadcast"];
    session: ChatSession;
  }): Promise<void> {
    const { chatId, aggregate, turnId, broadcast, session } = params;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      if (!aggregate.isCurrentTurn(turnId)) {
        return;
      }
      await this.finalizeAssistantArtifactsUnderLock({
        chatId,
        aggregate,
        session,
        broadcast,
        turnId,
      });
    });
  }

  private async handlePromptAborted(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    reason: string;
  }): Promise<void> {
    const { chatId, aggregate, session, broadcast, turnId, reason } = params;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      if (!aggregate.isCurrentTurn(turnId)) {
        return;
      }
      await this.finalizeAssistantArtifactsUnderLock({
        chatId,
        aggregate,
        session,
        broadcast,
        turnId,
      });
      aggregate.setChatFinishStopReason("cancelled", turnId);
      await aggregate.maybeBroadcastChatFinish({ chatId, broadcast });
      await aggregate.markReadyAfterTurnCompletion(
        { chatId, broadcast },
        turnId
      );
      aggregate.clearActiveTurnIf(turnId);
      this.logger.warn("Prompt task aborted after subscriber disconnect", {
        chatId,
        turnId,
        reason,
      });
    });
  }

  private async finalizeTurnReadyAfterError(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    turnId: string;
    broadcast: SessionRuntimePort["broadcast"];
    session: ChatSession;
    errorMessage: string;
  }): Promise<void> {
    const { chatId, aggregate, turnId, broadcast, session, errorMessage } =
      params;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      if (!aggregate.isCurrentTurn(turnId)) {
        return;
      }
      await this.finalizeAssistantArtifactsUnderLock({
        chatId,
        aggregate,
        session,
        broadcast,
        turnId,
      });
      await broadcast(chatId, {
        type: "error",
        error: errorMessage,
      });
      await aggregate.markReadyAfterTurnCompletion(
        { chatId, broadcast },
        turnId
      );
      aggregate.clearActiveTurnIf(turnId);
    });
  }

  private async handlePromptExhausted(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    maxAttempts: number;
  }): Promise<null> {
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

    await this.persistAssistantFallbackMessage({
      chatId,
      aggregate,
      turnId,
      broadcast,
      errorMessage: "Failed to send message",
    });
    await this.finalizeCurrentTurnArtifacts({
      chatId,
      aggregate,
      turnId,
      broadcast,
      session,
    });
    await this.sessionGateway.stopAndCleanup({
      chatId,
      session,
      turnId: aggregate.isCurrentTurn(turnId) ? turnId : undefined,
      reason: "Failed to send message",
      killProcess: true,
    });
    return null;
  }

  private async finalizePromptSuccess(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
    stopReason: string;
  }): Promise<void> {
    const { chatId, aggregate, session, broadcast, turnId, stopReason } =
      params;

    // Wrap ALL state mutations in runExclusive to serialize with streaming
    // update handlers. Without this, late-arriving ACP notifications processed
    // inside handleSessionUpdate (which also uses runExclusive) could race
    // with finalization — e.g. clearCurrentStreamingAssistantId() runs while
    // a streaming update is queued, causing the update to create a NEW
    // assistant message instead of appending to the existing one.
    await this.sessionRuntime.runExclusive(chatId, async () => {
      const finalizedAssistantMessageId =
        await this.finalizeAssistantArtifactsUnderLock({
          chatId,
          aggregate,
          session,
          broadcast,
          turnId,
        });
      if (finalizedAssistantMessageId) {
        setChatFinishMessage(session, finalizedAssistantMessageId, turnId);
      }

      aggregate.setChatFinishStopReason(stopReason, turnId);
      const chatFinishPreview = buildChatFinishEvent(session);
      await aggregate.maybeBroadcastChatFinish({
        chatId,
        broadcast,
      });
      this.logger.debug("SendMessageService chat finish broadcast", {
        chatId,
        stopReason,
        finishReason: mapStopReasonToFinishReason(stopReason),
        messageId: chatFinishPreview?.messageId ?? null,
        hasEmbeddedMessage: Boolean(chatFinishPreview?.message),
        previewPartsCount: chatFinishPreview?.message?.parts.length ?? 0,
        currentAssistantMessageId: session.uiState.currentAssistantId ?? null,
        lastAssistantMessageId: session.uiState.lastAssistantId ?? null,
        turnId,
      });

      await aggregate.markReadyAfterTurnCompletion(
        { chatId, broadcast },
        turnId
      );
      if (session.chatStatus === SESSION_RUNTIME_CHAT_STATUS.READY) {
        this.logger.debug("SendMessageService chat status ready", {
          chatId,
          turnId,
        });
      }
      aggregate.clearActiveTurnIf(turnId);
    });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Refactoring would require significant interface changes
  private async finalizeAssistantArtifactsUnderLock(params: {
    chatId: string;
    aggregate: SessionRuntimeEntity;
    session: ChatSession;
    broadcast: SessionRuntimePort["broadcast"];
    turnId: string;
  }): Promise<string | undefined> {
    const { chatId, aggregate, session, broadcast, turnId } = params;
    let finalizedAssistantMessageId: string | undefined;
    let flushedAssistantBuffer: ReturnType<
      NonNullable<ChatSession["buffer"]>["flush"]
    > = null;

    if (session.buffer?.hasPendingReasoning()) {
      const bufferedMessageId = session.buffer.ensureMessageId(
        session.uiState.currentAssistantId
      );
      const currentAssistantMessage = getOrCreateAssistantMessage(
        session.uiState,
        bufferedMessageId
      );
      let updatedAssistantMessage = currentAssistantMessage;
      const pendingReasoning = session.buffer.consumePendingReasoning();
      if (pendingReasoning?.blocks.length) {
        const previousPartsLength = currentAssistantMessage.parts.length;
        for (const block of pendingReasoning.blocks) {
          updatedAssistantMessage = appendReasoningBlock(
            updatedAssistantMessage,
            block,
            "done"
          );
        }
        if (updatedAssistantMessage !== currentAssistantMessage) {
          session.uiState.messages.set(
            updatedAssistantMessage.id,
            updatedAssistantMessage
          );
          const partIndex = updatedAssistantMessage.parts.length - 1;
          const isNew =
            updatedAssistantMessage.parts.length > previousPartsLength;
          const part =
            partIndex >= 0
              ? updatedAssistantMessage.parts[partIndex]
              : undefined;
          if (partIndex >= 0 && part) {
            const partEvent = buildUiMessagePartEvent({
              state: session.uiState,
              message: updatedAssistantMessage,
              partIndex,
              isNew,
              turnId,
            });
            if (partEvent) {
              await broadcast(chatId, partEvent);
            }
          }
        }
      }
    }

    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        flushedAssistantBuffer = message;
        finalizedAssistantMessageId = message.id;
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
    if (!current) {
      if (flushedAssistantBuffer && finalizedAssistantMessageId) {
        const existingFinalMessage = session.uiState.messages.get(
          finalizedAssistantMessageId
        );
        const materializedMessage =
          existingFinalMessage ??
          buildAssistantMessageFromBlocks({
            messageId: flushedAssistantBuffer.id,
            contentBlocks: flushedAssistantBuffer.contentBlocks,
            reasoningBlocks: flushedAssistantBuffer.reasoningBlocks,
            createdAt: this.clock.nowMs(),
          });
        if (!existingFinalMessage) {
          session.uiState.messages.set(
            materializedMessage.id,
            materializedMessage
          );
        }
        session.uiState.lastAssistantId = materializedMessage.id;
        await broadcast(chatId, {
          type: "ui_message",
          message: materializedMessage,
          turnId,
        });
        this.logger.warn(
          "SendMessageService materialized assistant snapshot from flushed buffer",
          {
            chatId,
            messageId: materializedMessage.id,
            parts: materializedMessage.parts.length,
            contentBlocks: flushedAssistantBuffer.contentBlocks.length,
            reasoningBlocks:
              flushedAssistantBuffer.reasoningBlocks?.length ?? 0,
            turnId,
          }
        );
      }
      return finalizedAssistantMessageId;
    }

    finalizedAssistantMessageId = current.id;
    const finalizedMessage = finalizeStreamingParts(current);
    if (finalizedMessage !== current) {
      session.uiState.messages.set(finalizedMessage.id, finalizedMessage);
      for (let index = 0; index < finalizedMessage.parts.length; index += 1) {
        const previousPart = current.parts[index];
        const nextPart = finalizedMessage.parts[index];
        if (!(previousPart && nextPart) || previousPart === nextPart) {
          continue;
        }
        const partEvent = buildUiMessagePartEvent({
          state: session.uiState,
          message: finalizedMessage,
          partIndex: index,
          isNew: false,
          turnId,
        });
        if (partEvent) {
          await broadcast(chatId, partEvent);
        }
      }
    }
    this.logger.debug("SendMessageService finalized streaming message", {
      chatId,
      messageId: finalizedMessage.id,
      parts: finalizedMessage.parts.length,
      emittedPartUpdates:
        finalizedMessage === current
          ? 0
          : finalizedMessage.parts.reduce((count, part, index) => {
              return part !== current.parts[index] ? count + 1 : count;
            }, 0),
      turnId,
    });
    aggregate.clearCurrentStreamingAssistantId();
    return finalizedAssistantMessageId;
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

function getAbortReasonText(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }
  return "Prompt aborted";
}
