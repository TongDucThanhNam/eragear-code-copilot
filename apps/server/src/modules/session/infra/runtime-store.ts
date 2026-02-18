/**
 * Session Runtime Store
 *
 * In-memory storage for active session runtimes.
 * Manages active sessions with event buffering, broadcasting, and cleanup.
 *
 * @module modules/session/infra/runtime-store
 */

import { createLogger } from "@/platform/logging/structured-logger";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { SessionEventOutboxPort } from "../application/ports/session-event-outbox.port";
import type { SessionRuntimePort } from "../application/ports/session-runtime.port";

const logger = createLogger("Debug");
const MIN_LOCK_ACQUIRE_TIMEOUT_MS = 100;

export interface SessionRuntimeStorePolicy {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
  eventBusPublishTimeoutMs: number;
  eventBusPublishMaxQueuePerChat: number;
}

function normalizePolicy(policy: SessionRuntimeStorePolicy): {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
} {
  return {
    sessionBufferLimit: Math.max(1, Math.trunc(policy.sessionBufferLimit)),
    lockAcquireTimeoutMs: Math.max(
      MIN_LOCK_ACQUIRE_TIMEOUT_MS,
      Math.trunc(policy.lockAcquireTimeoutMs)
    ),
  };
}

class SessionLockAcquireTimeoutError extends Error {
  constructor(chatId: string, timeoutMs: number) {
    super(
      `[SessionRuntimeStore] Lock acquisition timed out for chat "${chatId}" after ${timeoutMs}ms`
    );
    this.name = "SessionLockAcquireTimeoutError";
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
  /** Maximum time waiting to acquire a per-chat lock */
  private readonly lockAcquireTimeoutMs: number;

  constructor(eventOutbox: SessionEventOutboxPort, policy: SessionRuntimeStorePolicy) {
    this.eventOutbox = eventOutbox;
    const normalizedPolicy = normalizePolicy(policy);
    this.sessionBufferLimit = normalizedPolicy.sessionBufferLimit;
    this.lockAcquireTimeoutMs = normalizedPolicy.lockAcquireTimeoutMs;
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
          logger.warn(
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
  }

  has(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  getAll(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  async runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T> {
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

    try {
      await this.waitForLock(previousTail, chatId);
      return await work();
    } catch (error) {
      if (error instanceof SessionLockAcquireTimeoutError) {
        logger.warn("Session lock timed out", {
          chatId,
          timeoutMs: this.lockAcquireTimeoutMs,
        });
      }
      throw error;
    } finally {
      releaseLock();
      if (this.chatLockTails.get(chatId) === nextTail) {
        this.chatLockTails.delete(chatId);
      }
    }
  }

  private async waitForLock(
    previousTail: Promise<void>,
    chatId: string
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new SessionLockAcquireTimeoutError(chatId, this.lockAcquireTimeoutMs)
        );
      }, this.lockAcquireTimeoutMs);
    });
    try {
      await Promise.race([previousTail.catch(() => undefined), timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async broadcast(chatId: string, event: BroadcastEvent): Promise<void> {
    await this.runExclusive(chatId, async () => {
      const session = this.sessions.get(chatId);
      if (!session) {
        return;
      }

      await this.eventOutbox.enqueue({
        chatId,
        userId: session.userId,
        event,
      });

      session.messageBuffer.push(event);
      if (session.messageBuffer.length > this.sessionBufferLimit) {
        session.messageBuffer.splice(
          0,
          session.messageBuffer.length - this.sessionBufferLimit
        );
      }

      session.emitter.emit("data", event);
    });
  }
}
