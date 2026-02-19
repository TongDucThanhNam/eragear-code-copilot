/**
 * Session Runtime Store
 *
 * In-memory storage for active session runtimes.
 * Manages active sessions with event buffering, broadcasting, and cleanup.
 *
 * @module modules/session/infra/runtime-store
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@/platform/logging/structured-logger";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { SessionEventOutboxPort } from "../application/ports/session-event-outbox.port";
import type {
  SessionBroadcastOptions,
  SessionRuntimePort,
} from "../application/ports/session-runtime.port";

let loggerInstance: ReturnType<typeof createLogger> | null = null;
const MIN_LOCK_WAIT_WARNING_MS = 100;

function getLogger() {
  if (!loggerInstance) {
    loggerInstance = createLogger("Debug");
  }
  return loggerInstance;
}

export interface SessionRuntimeStorePolicy {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
  eventBusPublishMaxQueuePerChat: number;
}

function normalizePolicy(policy: SessionRuntimeStorePolicy): {
  sessionBufferLimit: number;
  lockWaitWarningMs: number;
  maxQueuedMutationsPerChat: number;
} {
  return {
    sessionBufferLimit: Math.max(1, Math.trunc(policy.sessionBufferLimit)),
    lockWaitWarningMs: Math.max(
      MIN_LOCK_WAIT_WARNING_MS,
      Math.trunc(policy.lockAcquireTimeoutMs)
    ),
    maxQueuedMutationsPerChat: Math.max(
      1,
      Math.trunc(policy.eventBusPublishMaxQueuePerChat)
    ),
  };
}

class SessionMutationQueueOverflowError extends Error {
  constructor(chatId: string, pending: number, maxPending: number) {
    super(
      `[SessionRuntimeStore] Pending mutation queue overflow for chat "${chatId}" (${pending} >= ${maxPending})`
    );
    this.name = "SessionMutationQueueOverflowError";
  }
}

/**
 * SessionRuntimeStore
 *
 * In-memory implementation of SessionRuntimePort.
 * Stores active session runtimes, buffers messages, and enqueues durable
 * session broadcast events for eventual outbox dispatch.
 */
export class SessionRuntimeStore implements SessionRuntimePort {
  /** In-memory session storage keyed by chat ID */
  private readonly sessions = new Map<string, ChatSession>();
  /** Per-chat lock tails for exclusive state mutation */
  private readonly chatLockTails = new Map<string, Promise<void>>();
  /** Durable outbox used for cross-component fan-out */
  private readonly eventOutbox: SessionEventOutboxPort;
  /** Maximum retained buffered events per session */
  private readonly sessionBufferLimit: number;
  /** Warning threshold when lock acquisition latency is high */
  private readonly lockWaitWarningMs: number;
  /** Maximum queued state mutations per chat to cap memory growth */
  private readonly maxQueuedMutationsPerChat: number;
  /** Number of queued state mutations per chat */
  private readonly queuedMutationsPerChat = new Map<string, number>();
  /** Per-request lock re-entry context keyed by chat id */
  private readonly lockContextStorage = new AsyncLocalStorage<
    Map<string, number>
  >();

  constructor(
    eventOutbox: SessionEventOutboxPort,
    policy: SessionRuntimeStorePolicy
  ) {
    this.eventOutbox = eventOutbox;
    const normalizedPolicy = normalizePolicy(policy);
    this.sessionBufferLimit = normalizedPolicy.sessionBufferLimit;
    this.lockWaitWarningMs = normalizedPolicy.lockWaitWarningMs;
    this.maxQueuedMutationsPerChat = normalizedPolicy.maxQueuedMutationsPerChat;
  }

  set(chatId: string, session: ChatSession): void {
    this.sessions.set(chatId, session);
  }

  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (session) {
      for (const [, pending] of session.pendingPermissions) {
        try {
          pending.resolve({ outcome: { outcome: "cancelled" } });
        } catch (error) {
          getLogger().warn(
            "Failed to resolve pending permission during session delete",
            {
              chatId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
      session.pendingPermissions.clear();
    }
    this.sessions.delete(chatId);
    this.chatLockTails.delete(chatId);
    this.queuedMutationsPerChat.delete(chatId);
  }

  has(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  getAll(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  async runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    const activeContext = this.lockContextStorage.getStore();
    const activeDepth = activeContext?.get(chatId) ?? 0;
    if (activeContext && activeDepth > 0) {
      activeContext.set(chatId, activeDepth + 1);
      try {
        return await work();
      } finally {
        const nextDepth = (activeContext.get(chatId) ?? 1) - 1;
        if (nextDepth <= 0) {
          activeContext.delete(chatId);
        } else {
          activeContext.set(chatId, nextDepth);
        }
      }
    }

    this.reserveQueuedMutationSlot(chatId);
    const previousTail = this.chatLockTails.get(chatId) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const lockSignal = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const nextTail = previousTail.then(
      () => lockSignal,
      () => lockSignal
    );
    this.chatLockTails.set(chatId, nextTail);
    const scopedContext = activeContext
      ? new Map(activeContext)
      : new Map<string, number>();
    scopedContext.set(chatId, 1);
    const waitStartedAt = Date.now();

    try {
      await previousTail.catch(() => undefined);
      const waitMs = Date.now() - waitStartedAt;
      if (waitMs > this.lockWaitWarningMs) {
        getLogger().warn("Session lock acquisition latency exceeded threshold", {
          chatId,
          waitMs,
          thresholdMs: this.lockWaitWarningMs,
        });
      }
      return await this.lockContextStorage.run(scopedContext, async () => {
        return await work();
      });
    } catch (error) {
      if (error instanceof SessionMutationQueueOverflowError) {
        getLogger().warn("Session mutation queue overflow", {
          chatId,
          maxPending: this.maxQueuedMutationsPerChat,
        });
      }
      throw error;
    } finally {
      releaseLock();
      this.releaseQueuedMutationSlot(chatId);
      if (this.chatLockTails.get(chatId) === nextTail) {
        this.chatLockTails.delete(chatId);
      }
    }
  }

  private reserveQueuedMutationSlot(chatId: string): void {
    const pending = this.queuedMutationsPerChat.get(chatId) ?? 0;
    if (pending >= this.maxQueuedMutationsPerChat) {
      throw new SessionMutationQueueOverflowError(
        chatId,
        pending,
        this.maxQueuedMutationsPerChat
      );
    }
    this.queuedMutationsPerChat.set(chatId, pending + 1);
  }

  private releaseQueuedMutationSlot(chatId: string): void {
    const pending = this.queuedMutationsPerChat.get(chatId);
    if (pending === undefined) {
      return;
    }
    if (pending <= 1) {
      this.queuedMutationsPerChat.delete(chatId);
      return;
    }
    this.queuedMutationsPerChat.set(chatId, pending - 1);
  }

  async broadcast(
    chatId: string,
    event: BroadcastEvent,
    options?: SessionBroadcastOptions
  ): Promise<void> {
    const durable = options?.durable !== false;
    const retainInBuffer = options?.retainInBuffer !== false;
    await this.runExclusive(chatId, async () => {
      const session = this.sessions.get(chatId);
      if (!session) {
        return;
      }

      if (durable) {
        await this.eventOutbox.enqueue({
          chatId,
          userId: session.userId,
          event,
        });
      }

      if (retainInBuffer) {
        session.messageBuffer.push(event);
        if (session.messageBuffer.length > this.sessionBufferLimit) {
          session.messageBuffer.splice(
            0,
            session.messageBuffer.length - this.sessionBufferLimit
          );
        }
      }

      session.emitter.emit("data", event);
    });
  }
}
