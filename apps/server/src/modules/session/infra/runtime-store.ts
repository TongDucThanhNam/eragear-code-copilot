/**
 * Session Runtime Store
 *
 * In-memory storage for active session runtimes.
 * Manages active sessions with event buffering, broadcasting, and cleanup.
 *
 * @module modules/session/infra/runtime-store
 */

import type { EventBusPort } from "@/shared/ports/event-bus.port";
import { ENV } from "../../../config/environment";
import type {
  BroadcastEvent,
  ChatSession,
} from "../../../shared/types/session.types";
import type { SessionRuntimePort } from "../application/ports/session-runtime.port";

/**
 * SessionRuntimeStore
 *
 * In-memory implementation of SessionRuntimePort.
 * Stores active session runtimes, buffers messages, and handles broadcasting.
 *
 * @example
 * ```typescript
 * const store = new SessionRuntimeStore(eventBus);
 *
 * store.set(chatId, session);
 * const session = store.get(chatId);
 * store.broadcast(chatId, { type: "message", ... });
 * ```
 */
export class SessionRuntimeStore implements SessionRuntimePort {
  /** In-memory session storage keyed by chat ID */
  private readonly sessions = new Map<string, ChatSession>();
  /** Event bus for publishing broadcast events */
  private readonly eventBus: EventBusPort;

  /**
   * Creates a SessionRuntimeStore with the event bus dependency
   */
  constructor(eventBus: EventBusPort) {
    this.eventBus = eventBus;
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

  /**
   * Broadcasts an event to a session's subscribers
   *
   * Buffers the event, emits to local subscribers, and publishes to the event bus.
   * Maintains a circular buffer of recent events (limit: ENV.sessionBufferLimit).
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
    if (session.messageBuffer.length > ENV.sessionBufferLimit) {
      session.messageBuffer.splice(
        0,
        session.messageBuffer.length - ENV.sessionBufferLimit
      );
    }

    // Emit to subscribers
    session.emitter.emit("data", event);

    // Publish to event bus
    this.eventBus
      .publish({ type: "session_broadcast", chatId, event })
      .catch((error) => {
        console.error("[SessionRuntimeStore] Failed to publish event", error);
      });
  }
}
