/**
 * Event Bus Implementation
 *
 * Simple in-memory event bus for publishing and subscribing to domain events.
 * Implements the EventBusPort interface from the ports module.
 *
 * @module shared/utils/event-bus
 */

import type { EventBusPort } from "../ports/event-bus.port";

const MAX_EVENT_BUS_LISTENERS = 10_000;

/**
 * Base event structure for the bus
 */
export interface BusEvent {
  /** Event type identifier */
  type: string;
  /** Additional event properties */
  [key: string]: unknown;
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
  private readonly listeners = new Map<number, (event: BusEvent) => void>();
  private nextListenerId = 1;

  /**
   * Subscribe to events on the bus
   * @param listener - Callback function for events
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(
    listener: (event: BusEvent) => void,
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
  publish(event: BusEvent): void {
    const listeners = [...this.listeners.values()];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[EventBus] Listener error:", err);
      }
    }
  }
}
