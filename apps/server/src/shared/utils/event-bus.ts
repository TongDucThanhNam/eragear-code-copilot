/**
 * Event Bus Implementation
 *
 * Simple in-memory event bus for publishing and subscribing to domain events.
 * Implements the EventBusPort interface from the ports module.
 *
 * @module shared/utils/event-bus
 */

import type { EventBusPort } from "../../shared/types/ports";

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
  private listeners: Array<(event: BusEvent) => void> = [];

  /**
   * Subscribe to events on the bus
   * @param listener - Callback function for events
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(listener: (event: BusEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Publish an event to all subscribers
   * @param event - The event to publish
   */
  publish(event: BusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[EventBus] Listener error:", err);
      }
    }
  }
}
