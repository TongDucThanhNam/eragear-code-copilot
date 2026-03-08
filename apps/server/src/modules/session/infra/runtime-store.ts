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
import { cloneBroadcastEvent } from "@/shared/utils/broadcast-event.util";
import type { SessionEventOutboxPort } from "../application/ports/session-event-outbox.port";
import type {
  SessionBroadcastOptions,
  SessionRuntimePort,
} from "../application/ports/session-runtime.port";

let loggerInstance: ReturnType<typeof createLogger> | null = null;
const MIN_LOCK_WAIT_WARNING_MS = 100;
const QUEUE_PRESSURE_LOG_INTERVAL_MS = 1000;

export class SessionMutationQueueOverflowError extends Error {
  constructor(chatId: string, maxWaiters: number) {
    super(
      `Session mutation queue overflow for chat ${chatId} (max waiters: ${maxWaiters})`
    );
    this.name = "SessionMutationQueueOverflowError";
  }
}

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
  /** Preserved live emitter/subscriber channel across runtime replacement */
  private readonly detachedLiveChannels = new Map<
    string,
    Pick<ChatSession, "emitter" | "subscriberCount" | "idleSinceAt">
  >();
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
  /** Waiters blocked on per-chat queued mutation backpressure */
  private readonly queuedMutationWaiters = new Map<string, Array<() => void>>();
  /** Last queue pressure warning timestamp per chat */
  private readonly lastQueuePressureLogAt = new Map<string, number>();
  /** Last queue overflow warning timestamp per chat */
  private readonly lastQueueOverflowLogAt = new Map<string, number>();
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

  /**
   * Set/replace runtime session while preserving the live emitter channel when
   * the previous runtime still has subscribers attached.
   */
  set(chatId: string, session: ChatSession): void {
    const current = this.sessions.get(chatId);
    const detached = this.detachedLiveChannels.get(chatId);

    if (current && current !== session) {
      session.emitter = current.emitter;
      session.subscriberCount = current.subscriberCount;
      session.idleSinceAt = current.idleSinceAt;
    } else if (detached) {
      session.emitter = detached.emitter;
      session.subscriberCount = detached.subscriberCount;
      session.idleSinceAt = detached.idleSinceAt;
      this.detachedLiveChannels.delete(chatId);
    }

    this.sessions.set(chatId, session);
  }

  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    const session = this.sessions.get(chatId);
    this.preserveLiveChannel(chatId, session);
    this.cleanupSessionBeforeDelete(chatId, session);
    this.sessions.delete(chatId);
    this.clearRuntimeIndexes(chatId);
  }

  deleteIfMatch(chatId: string, expectedSession: ChatSession): boolean {
    const current = this.sessions.get(chatId);
    if (!current || current !== expectedSession) {
      return false;
    }
    this.preserveLiveChannel(chatId, current);
    this.cleanupSessionBeforeDelete(chatId, current);
    this.sessions.delete(chatId);
    this.clearRuntimeIndexes(chatId);
    return true;
  }

  private cleanupSessionBeforeDelete(
    chatId: string,
    session: ChatSession | undefined
  ): void {
    if (!session) {
      return;
    }
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

  private clearRuntimeIndexes(chatId: string): void {
    this.chatLockTails.delete(chatId);
    this.queuedMutationsPerChat.delete(chatId);
    this.lastQueuePressureLogAt.delete(chatId);
    this.lastQueueOverflowLogAt.delete(chatId);
    this.resolveQueuedMutationWaiters(chatId);
  }

  private preserveLiveChannel(
    chatId: string,
    session: ChatSession | undefined
  ): void {
    if (!session) {
      this.detachedLiveChannels.delete(chatId);
      return;
    }
    if (session.subscriberCount <= 0) {
      this.detachedLiveChannels.delete(chatId);
      return;
    }
    this.detachedLiveChannels.set(chatId, {
      emitter: session.emitter,
      subscriberCount: session.subscriberCount,
      idleSinceAt: session.idleSinceAt,
    });
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

    await this.reserveQueuedMutationSlot(chatId);
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
        getLogger().warn(
          "Session lock acquisition latency exceeded threshold",
          {
            chatId,
            waitMs,
            thresholdMs: this.lockWaitWarningMs,
          }
        );
      }
      return await this.lockContextStorage.run(scopedContext, async () => {
        return await work();
      });
    } finally {
      releaseLock();
      this.releaseQueuedMutationSlot(chatId);
      if (this.chatLockTails.get(chatId) === nextTail) {
        this.chatLockTails.delete(chatId);
      }
    }
  }

  isLockHeld(chatId: string): boolean {
    const activeContext = this.lockContextStorage.getStore();
    return (activeContext?.get(chatId) ?? 0) > 0;
  }

  private async reserveQueuedMutationSlot(chatId: string): Promise<void> {
    while (true) {
      const pending = this.queuedMutationsPerChat.get(chatId) ?? 0;
      if (pending < this.maxQueuedMutationsPerChat) {
        this.queuedMutationsPerChat.set(chatId, pending + 1);
        return;
      }
      this.logQueuePressure(chatId, pending);
      await this.waitForQueuedMutationSlot(chatId);
    }
  }

  private releaseQueuedMutationSlot(chatId: string): void {
    const pending = this.queuedMutationsPerChat.get(chatId);
    if (pending === undefined) {
      return;
    }
    const nextPending = pending - 1;
    if (nextPending <= 0) {
      this.queuedMutationsPerChat.delete(chatId);
    } else {
      this.queuedMutationsPerChat.set(chatId, nextPending);
    }
    if (nextPending < this.maxQueuedMutationsPerChat) {
      this.resolveNextQueuedMutationWaiter(chatId);
    }
  }

  private waitForQueuedMutationSlot(chatId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const current = this.queuedMutationWaiters.get(chatId) ?? [];
      if (current.length >= this.maxQueuedMutationsPerChat) {
        this.logQueueOverflow(chatId, current.length);
        throw new SessionMutationQueueOverflowError(
          chatId,
          this.maxQueuedMutationsPerChat
        );
      }
      current.push(resolve);
      this.queuedMutationWaiters.set(chatId, current);
    });
  }

  private resolveNextQueuedMutationWaiter(chatId: string): void {
    const waiters = this.queuedMutationWaiters.get(chatId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    const next = waiters.shift();
    if (waiters.length === 0) {
      this.queuedMutationWaiters.delete(chatId);
    }
    next?.();
  }

  private resolveQueuedMutationWaiters(chatId: string): void {
    const waiters = this.queuedMutationWaiters.get(chatId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.queuedMutationWaiters.delete(chatId);
    for (const waiter of waiters) {
      waiter();
    }
  }

  private logQueuePressure(chatId: string, pending: number): void {
    const now = Date.now();
    const lastLoggedAt = this.lastQueuePressureLogAt.get(chatId) ?? 0;
    if (now - lastLoggedAt < QUEUE_PRESSURE_LOG_INTERVAL_MS) {
      return;
    }
    this.lastQueuePressureLogAt.set(chatId, now);
    getLogger().warn("Session mutation queue backpressure engaged", {
      chatId,
      pending,
      maxPending: this.maxQueuedMutationsPerChat,
    });
  }

  private logQueueOverflow(chatId: string, waiters: number): void {
    const now = Date.now();
    const lastLoggedAt = this.lastQueueOverflowLogAt.get(chatId) ?? 0;
    if (now - lastLoggedAt < QUEUE_PRESSURE_LOG_INTERVAL_MS) {
      return;
    }
    this.lastQueueOverflowLogAt.set(chatId, now);
    getLogger().warn("Session mutation waiter queue overflow", {
      chatId,
      waiters,
      maxWaiters: this.maxQueuedMutationsPerChat,
    });
  }

  async broadcast(
    chatId: string,
    event: BroadcastEvent,
    options?: SessionBroadcastOptions
  ): Promise<void> {
    if (this.isLockHeld(chatId)) {
      await this.broadcastWithinLock(chatId, event, options);
      return;
    }
    await this.runExclusive(chatId, async () => {
      await this.broadcastWithinLock(chatId, event, options);
    });
  }

  private async broadcastWithinLock(
    chatId: string,
    event: BroadcastEvent,
    options?: SessionBroadcastOptions
  ): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) {
      return;
    }

    // High-frequency part updates are non-durable by default to avoid
    // SQLite write amplification. We still retain them in runtime buffer so
    // short WS reconnects can replay in-order chunk snapshots.
    const durable =
      options?.durable ??
      (event.type === "ui_message_part" ||
      event.type === "ui_message_part_removed"
        ? false
        : true);
    const retainInBuffer = options?.retainInBuffer ?? true;

    if (durable) {
      await this.eventOutbox.enqueue({
        chatId,
        userId: session.userId,
        event: cloneBroadcastEvent(event),
      });
    }

    if (retainInBuffer) {
      session.messageBuffer.push(cloneBroadcastEvent(event));
      if (session.messageBuffer.length > this.sessionBufferLimit) {
        session.messageBuffer.splice(
          0,
          session.messageBuffer.length - this.sessionBufferLimit
        );
      }
    }

    await this.emitLiveEvent(session, event);
  }

  private async emitLiveEvent(
    session: ChatSession,
    event: BroadcastEvent
  ): Promise<void> {
    const listeners = session.emitter.listeners("data");
    if (listeners.length === 0) {
      return;
    }

    const pendingDeliveries: Promise<void>[] = [];
    for (const listener of listeners) {
      try {
        const result = (
          listener as (event: BroadcastEvent) => void | Promise<void>
        )(cloneBroadcastEvent(event));
        if (isPromiseLike(result)) {
          pendingDeliveries.push(result);
        }
      } catch (error) {
        getLogger().warn("Session live event listener threw", {
          chatId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (pendingDeliveries.length === 0) {
      return;
    }
    const settled = await Promise.allSettled(pendingDeliveries);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        continue;
      }
      getLogger().warn("Session live event delivery rejected", {
        chatId: session.id,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }
}

function isPromiseLike(
  value: void | Promise<void>
): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
