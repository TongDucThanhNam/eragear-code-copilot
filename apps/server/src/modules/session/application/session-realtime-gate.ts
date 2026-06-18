import { ENV } from "@/config/environment";
import { AppError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  ActivePromptTask,
  ChatSession,
  ChatStatus,
} from "@/shared/types/session.types";
import { reconcileChatStatusForSubscription } from "@/shared/utils/chat-events.util";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const HTTP_STATUS_CONFLICT = 409;
const NO_SUBSCRIBER_ABORT_REASON =
  "Prompt aborted after realtime subscribers disconnected";
const RELEASE_OP = "session.realtime.release_subscription";
const ABORT_ORPHANED_PROMPT_OP = "session.realtime.abort_orphaned_prompt";

export type PromptSubmissionSource = "client" | "supervisor" | "automation";

export interface SessionRealtimeGateDeps {
  sessionRuntime: SessionRuntimePort;
  logger: Pick<LoggerPort, "warn">;
}

export interface AssertPromptCanSubmitInput {
  chatId: string;
  session: ChatSession;
  source?: PromptSubmissionSource;
  module: string;
  op: string;
}

export interface ReleaseRealtimeSubscriptionInput {
  chatId: string;
  session: ChatSession;
  op?: string;
}

/**
 * Owns realtime liveness policy for runtime sessions.
 *
 * Caller contract: prompt submission checks must run under the chat mutation
 * lock; subscription release acquires that lock internally.
 */
export class SessionRealtimeGate {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logger: Pick<LoggerPort, "warn">;

  constructor(deps: SessionRealtimeGateDeps) {
    this.sessionRuntime = deps.sessionRuntime;
    this.logger = deps.logger;
  }

  prepareSubscription(session: ChatSession): ChatStatus {
    session.idleSinceAt = undefined;
    clearNoSubscriberAbortTimer(session.activePromptTask);
    const nextChatStatus = reconcileChatStatusForSubscription(session);
    if (nextChatStatus !== session.chatStatus) {
      session.chatStatus = nextChatStatus;
    }
    return nextChatStatus;
  }

  recordSubscriptionAttached(session: ChatSession): number {
    session.subscriberCount = session.emitter.listenerCount("data");
    return session.subscriberCount;
  }

  async releaseSubscription(
    input: ReleaseRealtimeSubscriptionInput
  ): Promise<void> {
    const { chatId, session, op = RELEASE_OP } = input;
    await this.sessionRuntime.runExclusive(chatId, () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op,
      });
      const current = this.sessionRuntime.get(chatId);
      if (!current || current.userId !== session.userId) {
        return Promise.resolve();
      }
      const sameChannel =
        current === session || current.emitter === session.emitter;
      if (!sameChannel) {
        return Promise.resolve();
      }
      current.subscriberCount = current.emitter.listenerCount("data");
      if (current.subscriberCount <= 0) {
        current.idleSinceAt = Date.now();
        this.scheduleNoSubscriberPromptAbort(chatId, current);
      } else {
        clearNoSubscriberAbortTimer(current.activePromptTask);
      }
      return Promise.resolve();
    });
  }

  assertPromptCanSubmit(input: AssertPromptCanSubmitInput): void {
    const { chatId, session } = input;
    const liveSubscriberCount = session.emitter.listenerCount("data");
    if (session.subscriberCount !== liveSubscriberCount) {
      this.logger.warn("SessionRealtimeGate repaired subscriber count drift", {
        chatId,
        sessionId: session.sessionId,
        trackedSubscriberCount: session.subscriberCount,
        emitterSubscriberCount: liveSubscriberCount,
      });
      session.subscriberCount = liveSubscriberCount;
    }

    if (
      canSubmitWithoutSubscriber(input.source) ||
      liveSubscriberCount > 0 ||
      session.subscriberCount > 0
    ) {
      return;
    }

    this.logger.warn(
      "SessionRealtimeGate rejected prompt without subscribers",
      {
        chatId,
        sessionId: session.sessionId,
        chatStatus: session.chatStatus,
        subscriberCount: session.subscriberCount,
        emitterSubscriberCount: liveSubscriberCount,
      }
    );
    throw new AppError({
      message:
        "Realtime chat stream is not connected. Reconnect session events and retry.",
      code: "SESSION_SUBSCRIPTION_REQUIRED",
      statusCode: HTTP_STATUS_CONFLICT,
      module: input.module,
      op: input.op,
      details: {
        chatId,
        sessionId: session.sessionId,
        chatStatus: session.chatStatus,
        subscriberCount: session.subscriberCount,
        emitterSubscriberCount: liveSubscriberCount,
      },
    });
  }

  private scheduleNoSubscriberPromptAbort(
    chatId: string,
    session: ChatSession
  ): void {
    const task = session.activePromptTask;
    if (!task) {
      return;
    }
    clearNoSubscriberAbortTimer(task);
    task.orphanedSinceAt = Date.now();
    task.noSubscriberAbortReason = NO_SUBSCRIBER_ABORT_REASON;
    task.noSubscriberAbortTimer = setTimeout(() => {
      this.sessionRuntime
        .runExclusive(chatId, () => {
          assertSessionMutationLock({
            sessionRuntime: this.sessionRuntime,
            chatId,
            op: ABORT_ORPHANED_PROMPT_OP,
          });
          const current = this.sessionRuntime.get(chatId);
          if (!current || current !== session) {
            return Promise.resolve();
          }
          const currentTask = current.activePromptTask;
          if (!currentTask || currentTask.turnId !== task.turnId) {
            return Promise.resolve();
          }
          current.subscriberCount = current.emitter.listenerCount("data");
          if (current.subscriberCount > 0) {
            clearNoSubscriberAbortTimer(currentTask);
            return Promise.resolve();
          }
          const reason =
            currentTask.noSubscriberAbortReason ?? NO_SUBSCRIBER_ABORT_REASON;
          clearNoSubscriberAbortTimer(currentTask);
          currentTask.abortController?.abort(reason);
          this.logger.warn(
            "Aborted orphaned prompt after subscriber grace period",
            {
              chatId,
              turnId: currentTask.turnId,
              graceMs: ENV.promptNoSubscriberAbortGraceMs,
            }
          );
          return Promise.resolve();
        })
        .catch((error) => {
          this.logger.warn("Failed to abort orphaned prompt", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, ENV.promptNoSubscriberAbortGraceMs);
    task.noSubscriberAbortTimer.unref?.();
  }
}

function canSubmitWithoutSubscriber(
  source: PromptSubmissionSource | undefined
): boolean {
  return source === "supervisor" || source === "automation";
}

function clearNoSubscriberAbortTimer(task: ActivePromptTask | undefined): void {
  if (!task) {
    return;
  }
  if (task.noSubscriberAbortTimer) {
    clearTimeout(task.noSubscriberAbortTimer);
    task.noSubscriberAbortTimer = undefined;
  }
  task.orphanedSinceAt = undefined;
  task.noSubscriberAbortReason = undefined;
}
