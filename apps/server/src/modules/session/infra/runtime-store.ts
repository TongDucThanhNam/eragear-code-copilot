/**
 * Session Runtime Store
 *
 * In-memory storage for active session runtimes.
 * Manages active sessions with event buffering, broadcasting, and cleanup.
 *
 * @module modules/session/infra/runtime-store
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { SessionEventOutboxPort } from "../application/ports/session-event-outbox.port";
import type {
  SessionBroadcastOptions,
  SessionRuntimePort,
} from "../application/ports/session-runtime.port";

let loggerInstance: ReturnType<typeof createLogger> | null = null;
const MIN_LOCK_WAIT_WARNING_MS = 100;
const QUEUE_PRESSURE_LOG_INTERVAL_MS = 1000;

function getLogger() {
  if (!loggerInstance) {
    loggerInstance = createLogger("Debug");
  }
  return loggerInstance;
}

function shouldLogStreamEvent(event: BroadcastEvent): boolean {
  return event.type === "ui_message" || event.type === "ui_message_delta";
}

function buildStreamEventContext(
  event: BroadcastEvent
): Record<string, unknown> {
  if (event.type === "ui_message") {
    return {
      messageId: event.message.id,
      partsCount: event.message.parts.length,
    };
  }
  if (event.type === "ui_message_delta") {
    return {
      messageId: event.messageId,
      partIndex: event.partIndex,
      deltaLength: event.delta.length,
    };
  }
  return {
    eventType: event.type,
  };
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
    this.lastQueuePressureLogAt.delete(chatId);
    this.resolveQueuedMutationWaiters(chatId);
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

      if (shouldEmitRuntimeLog("debug") && shouldLogStreamEvent(event)) {
        getLogger().debug("Session runtime event broadcast", {
          chatId,
          eventType: event.type,
          durable,
          retainInBuffer,
          subscriberCount: session.subscriberCount,
          bufferSize: session.messageBuffer.length,
          ...buildStreamEventContext(event),
        });
      }
      session.emitter.emit("data", event);
    });
  }
}
