/**
 * Event Bus Implementation
 *
 * Simple in-memory event bus for publishing and subscribing to domain events.
 * Implements the EventBusPort interface from the ports module.
 *
 * @module shared/utils/event-bus
 */

import type { EventBusListener, EventBusPort } from "../ports/event-bus.port";
import type { DomainEvent } from "../types/domain-events.types";

const MAX_EVENT_BUS_LISTENERS = 10_000;

interface EventBusLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Event bus implementation for pub/sub pattern
 *
 * @example
 * ```typescript
 * const bus = new EventBus();
 * const unsubscribe = bus.subscribe((event) => {
 *   console.log('Event received:', event.type);
 * });
 * bus.publish({ type: 'test', data: 'hello' });
 * unsubscribe();
 * ```
 */
export class EventBus implements EventBusPort {
  /** Registered event listeners */
  private readonly listeners = new Map<number, EventBusListener>();
  private readonly logger?: EventBusLogger;
  private nextListenerId = 1;

  constructor(logger?: EventBusLogger) {
    this.logger = logger;
  }

  /**
   * Subscribe to events on the bus
   * @param listener - Callback function for events
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(
    listener: EventBusListener,
    options?: { signal?: AbortSignal }
  ): () => void {
    if (this.listeners.size >= MAX_EVENT_BUS_LISTENERS) {
      throw new Error(
        `[EventBus] Listener limit exceeded (${MAX_EVENT_BUS_LISTENERS})`
      );
    }

    const signal = options?.signal;
    if (signal?.aborted) {
      return () => undefined;
    }

    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;
    this.listeners.set(listenerId, listener);

    const unsubscribe = () => {
      this.listeners.delete(listenerId);
      if (signal) {
        signal.removeEventListener("abort", unsubscribe);
      }
    };

    if (signal) {
      signal.addEventListener("abort", unsubscribe, { once: true });
    }

    return unsubscribe;
  }

  /**
   * Publish an event to all subscribers
   * @param event - The event to publish
   */
  async publish(event: DomainEvent): Promise<void> {
    const listeners = [...this.listeners.values()];
    let failedListeners = 0;
    for (const listener of listeners) {
      try {
        await listener(event);
      } catch (err) {
        failedListeners += 1;
        this.logger?.error("[EventBus] Listener error", {
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (failedListeners > 0) {
      this.logger?.error(
        "[EventBus] Publish completed with listener failures",
        {
          eventType: event.type,
          failedListeners,
          listenerCount: listeners.length,
        }
      );
    }
  }
}
