import type { DomainEvent } from "../types/domain-events.types";

export type EventBusListener = (event: DomainEvent) => void | Promise<void>;

/**
 * Port for event bus operations.
 */
export interface EventBusPort {
  /** Subscribe to events, returns unsubscribe function */
  subscribe(
    listener: EventBusListener,
    options?: { signal?: AbortSignal }
  ): () => void;
  /** Publish an event */
  publish(event: DomainEvent): Promise<void>;
}
