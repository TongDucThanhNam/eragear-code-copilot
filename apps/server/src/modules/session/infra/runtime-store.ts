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

export interface SessionRuntimeStorePolicy {
  sessionBufferLimit: number;
}

function normalizePolicy(policy: SessionRuntimeStorePolicy): {
  sessionBufferLimit: number;
} {
  return {
    sessionBufferLimit: Math.max(1, Math.trunc(policy.sessionBufferLimit)),
  };
}

/**
 * SessionRuntimeStore
 *
 * In-memory implementation of SessionRuntimePort.
 * Stores active session runtimes, buffers messages, and handles broadcasting.
 *
 * @example
 * ```typescript
 * const store = new SessionRuntimeStore(eventBus, { sessionBufferLimit: 200 });
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

  /**
   * Creates a SessionRuntimeStore with the event bus dependency
   */
  constructor(eventBus: EventBusPort, policy: SessionRuntimeStorePolicy) {
    this.eventBus = eventBus;
    this.sessionBufferLimit = normalizePolicy(policy).sessionBufferLimit;
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

    await previousTail.catch(() => undefined);
    try {
      return await work();
    } finally {
      releaseLock();
      if (this.chatLockTails.get(chatId) === nextTail) {
        this.chatLockTails.delete(chatId);
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
  broadcast(chatId: string, event: BroadcastEvent): void {
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
    this.eventBus
      .publish({
        type: "session_broadcast",
        userId: session.userId,
        chatId,
        event,
      })
      .catch((error) => {
        logger.error(
          "Failed to publish session event to event bus",
          error as Error,
          { chatId, userId: session.userId }
        );
      });
  }
}
