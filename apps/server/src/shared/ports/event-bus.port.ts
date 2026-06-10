import type { DomainEvent } from "../types/domain-events.types";

/**
 * Per-publish cancellation context passed to event listeners.
 *
 * Ordering note: listeners should observe the signal before starting expensive
 * work because publisher shutdown may abort fan-out.
 */
export interface EventBusPublishContext {
  signal: AbortSignal;
}

/**
 * Domain event listener invoked by the in-process event bus.
 *
 * Error mode: listener failures are handled by the event bus adapter; listeners
 * should still avoid throwing for expected filtering/no-op cases.
 */
export type EventBusListener = (
  event: DomainEvent,
  context: EventBusPublishContext
) => void | Promise<void>;

/**
 * In-process domain event fan-out port.
 *
 * Caller contract: `publish` completes after the adapter has attempted current
 * listeners; it is not a durable queue and must not be used as the only source
 * of truth for business state.
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
