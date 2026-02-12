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
const MIN_EVENT_BUS_PUBLISH_TIMEOUT_MS = 10;
const MIN_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT = 1;

export interface SessionRuntimeStorePolicy {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
  eventBusPublishTimeoutMs: number;
  eventBusPublishMaxQueuePerChat: number;
}

function normalizePolicy(policy: SessionRuntimeStorePolicy): {
  sessionBufferLimit: number;
  lockAcquireTimeoutMs: number;
  eventBusPublishTimeoutMs: number;
  eventBusPublishMaxQueuePerChat: number;
} {
  return {
    sessionBufferLimit: Math.max(1, Math.trunc(policy.sessionBufferLimit)),
    lockAcquireTimeoutMs: Math.max(
      MIN_LOCK_ACQUIRE_TIMEOUT_MS,
      Math.trunc(policy.lockAcquireTimeoutMs)
    ),
    eventBusPublishTimeoutMs: Math.max(
      MIN_EVENT_BUS_PUBLISH_TIMEOUT_MS,
      Math.trunc(policy.eventBusPublishTimeoutMs)
    ),
    eventBusPublishMaxQueuePerChat: Math.max(
      MIN_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT,
      Math.trunc(policy.eventBusPublishMaxQueuePerChat)
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

class EventBusPublishTimeoutError extends Error {
  constructor(chatId: string, timeoutMs: number) {
    super(
      `[SessionRuntimeStore] Event bus publish timed out for chat "${chatId}" after ${timeoutMs}ms`
    );
    this.name = "EventBusPublishTimeoutError";
  }
}

interface ChatPublishState {
  queueSize: number;
  tail: Promise<void>;
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
 *   eventBusPublishTimeoutMs: 250,
 *   eventBusPublishMaxQueuePerChat: 500,
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
  /** Per-chat event bus publish state to preserve ordering and back-pressure */
  private readonly chatPublishStates = new Map<string, ChatPublishState>();
  /** Event bus for publishing broadcast events */
  private readonly eventBus: EventBusPort;
  /** Maximum retained buffered events per session */
  private readonly sessionBufferLimit: number;
  /** Maximum time waiting to acquire a per-chat lock */
  private readonly lockAcquireTimeoutMs: number;
  /** Maximum time waiting for one event bus publish */
  private readonly eventBusPublishTimeoutMs: number;
  /** Max queued event bus publish jobs per chat */
  private readonly eventBusPublishMaxQueuePerChat: number;

  /**
   * Creates a SessionRuntimeStore with the event bus dependency
   */
  constructor(eventBus: EventBusPort, policy: SessionRuntimeStorePolicy) {
    this.eventBus = eventBus;
    const normalizedPolicy = normalizePolicy(policy);
    this.sessionBufferLimit = normalizedPolicy.sessionBufferLimit;
    this.lockAcquireTimeoutMs = normalizedPolicy.lockAcquireTimeoutMs;
    this.eventBusPublishTimeoutMs = normalizedPolicy.eventBusPublishTimeoutMs;
    this.eventBusPublishMaxQueuePerChat =
      normalizedPolicy.eventBusPublishMaxQueuePerChat;
  }

  /**
   * Stores a session in the runtime
   *
   * @param chatId - The session identifier
   * @param session - The session runtime object
   */
  set(chatId: string, session: ChatSession): void {
    const existing = this.sessions.get(chatId);
    if (existing && existing !== session) {
      this.chatPublishStates.delete(chatId);
    }
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
    this.chatPublishStates.delete(chatId);
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
  broadcast(chatId: string, event: BroadcastEvent): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) {
      return Promise.resolve();
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

    // Event bus fan-out is best-effort and intentionally detached from ACP/UI hot-path.
    this.enqueueEventBusPublish(chatId, session.userId, event);
    return Promise.resolve();
  }

  private enqueueEventBusPublish(
    chatId: string,
    userId: string,
    event: BroadcastEvent
  ): void {
    const publishState =
      this.chatPublishStates.get(chatId) ?? this.createChatPublishState(chatId);
    if (publishState.queueSize >= this.eventBusPublishMaxQueuePerChat) {
      logger.warn("Event bus publish queue is full for chat", {
        chatId,
        userId,
        maxQueue: this.eventBusPublishMaxQueuePerChat,
      });
      return;
    }

    publishState.queueSize += 1;
    const previousTail = publishState.tail;
    const nextTask = previousTail
      .catch(() => undefined)
      .then(async () => {
        await this.publishToEventBusWithTimeout(chatId, userId, event);
      })
      .catch((error) => {
        if (error instanceof EventBusPublishTimeoutError) {
          logger.warn("Event bus publish timed out", {
            chatId,
            userId,
            timeoutMs: this.eventBusPublishTimeoutMs,
          });
          return;
        }
        logger.error(
          "Failed to publish session event to event bus",
          error as Error,
          { chatId, userId }
        );
      });

    let currentTail: Promise<void> = Promise.resolve();
    currentTail = nextTask.finally(() => {
      publishState.queueSize = Math.max(0, publishState.queueSize - 1);
      const activeState = this.chatPublishStates.get(chatId);
      if (activeState !== publishState) {
        return;
      }
      if (publishState.tail === currentTail && publishState.queueSize === 0) {
        this.chatPublishStates.delete(chatId);
      }
    });

    publishState.tail = currentTail;
  }

  private createChatPublishState(chatId: string): ChatPublishState {
    const state: ChatPublishState = {
      queueSize: 0,
      tail: Promise.resolve(),
    };
    this.chatPublishStates.set(chatId, state);
    return state;
  }

  private async publishToEventBusWithTimeout(
    chatId: string,
    userId: string,
    event: BroadcastEvent
  ): Promise<void> {
    const publishPromise = this.eventBus.publish({
      type: "session_broadcast",
      userId,
      chatId,
      event,
    });
    // When timeout wins race, ensure late rejections are consumed.
    publishPromise.catch(() => undefined);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new EventBusPublishTimeoutError(chatId, this.eventBusPublishTimeoutMs)
        );
      }, this.eventBusPublishTimeoutMs);
    });
    try {
      await Promise.race([publishPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
