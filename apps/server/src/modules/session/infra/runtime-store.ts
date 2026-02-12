/**
 * Session Runtime Store
 *
 * In-memory storage for active session runtimes.
 * Manages active sessions with event buffering, broadcasting, and cleanup.
 *
 * @module modules/session/infra/runtime-store
 */

import { createLogger } from "@/platform/logging/structured-logger";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type {
  BroadcastEvent,
  ChatSession,
} from "../../../shared/types/session.types";
import type { SessionRuntimePort } from "../application/ports/session-runtime.port";

const logger = createLogger("Debug");
const MIN_LOCK_ACQUIRE_TIMEOUT_MS = 100;

export interface SessionRuntimeStorePolicy {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
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

export class SessionBroadcastError extends Error {
  constructor(chatId: string, userId: string, cause: unknown) {
    super(
      `[SessionRuntimeStore] Broadcast failed for chat "${chatId}" (user "${userId}")`
    );
    this.name = "SessionBroadcastError";
    if (cause instanceof Error) {
      this.cause = cause;
      return;
    }
    this.cause = new Error(String(cause));
  }
}

/**
 * SessionRuntimeStore
 *
 * In-memory implementation of SessionRuntimePort.
 * Stores active session runtimes, buffers messages, and handles broadcasting.
 *
 * @example
 * ```typescript
 * const store = new SessionRuntimeStore(eventBus, {
 *   sessionBufferLimit: 200,
 *   lockAcquireTimeoutMs: 15000,
 * });
 *
 * store.set(chatId, session);
 * const session = store.get(chatId);
 * store.broadcast(chatId, { type: "message", ... });
 * ```
 */
export class SessionRuntimeStore implements SessionRuntimePort {
  /** In-memory session storage keyed by chat ID */
  private readonly sessions = new Map<string, ChatSession>();
  /** Per-chat lock tails for exclusive state mutation */
  private readonly chatLockTails = new Map<string, Promise<void>>();
  /** Event bus for publishing broadcast events */
  private readonly eventBus: EventBusPort;
  /** Maximum retained buffered events per session */
  private readonly sessionBufferLimit: number;
  /** Maximum time waiting to acquire a per-chat lock */
  private readonly lockAcquireTimeoutMs: number;

  /**
   * Creates a SessionRuntimeStore with the event bus dependency
   */
  constructor(eventBus: EventBusPort, policy: SessionRuntimeStorePolicy) {
    this.eventBus = eventBus;
    const normalizedPolicy = normalizePolicy(policy);
    this.sessionBufferLimit = normalizedPolicy.sessionBufferLimit;
    this.lockAcquireTimeoutMs = normalizedPolicy.lockAcquireTimeoutMs;
  }

  /**
   * Stores a session in the runtime
   *
   * @param chatId - The session identifier
   * @param session - The session runtime object
   */
  set(chatId: string, session: ChatSession): void {
    this.sessions.set(chatId, session);
  }

  /**
   * Retrieves a session from the runtime
   *
   * @param chatId - The session identifier
   * @returns The session or undefined if not found
   */
  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Removes a session from the runtime
   *
   * @param chatId - The session identifier
   */
  delete(chatId: string): void {
    this.sessions.delete(chatId);
    this.chatLockTails.delete(chatId);
  }

  /**
   * Checks if a session exists in the runtime
   *
   * @param chatId - The session identifier
   * @returns True if session exists
   */
  has(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  /**
   * Gets all active sessions
   *
   * @returns Array of all session runtimes
   */
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

  /**
   * Broadcasts an event to a session's subscribers
   *
   * Buffers the event, emits to local subscribers, and publishes to the event bus.
   * Maintains a circular buffer of recent events (limit: configured policy).
   *
   * @param chatId - The session identifier
   * @param event - The broadcast event
   */
  async broadcast(chatId: string, event: BroadcastEvent): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) {
      return;
    }

    // Buffer the event
    session.messageBuffer.push(event);
    if (session.messageBuffer.length > this.sessionBufferLimit) {
      session.messageBuffer.splice(
        0,
        session.messageBuffer.length - this.sessionBufferLimit
      );
    }

    // Emit to subscribers
    session.emitter.emit("data", event);

    // Publish to event bus
    try {
      await this.eventBus.publish({
        type: "session_broadcast",
        userId: session.userId,
        chatId,
        event,
      });
    } catch (error) {
      logger.error(
        "Failed to publish session event to event bus",
        error as Error,
        { chatId, userId: session.userId }
      );
      throw new SessionBroadcastError(chatId, session.userId, error);
    }
  }
}
