/**
 * Port for event bus operations.
 */
export interface EventBusPort {
  /** Subscribe to events, returns unsubscribe function */
  subscribe(
    listener: (event: unknown) => void,
    options?: { signal?: AbortSignal }
  ): () => void;
  /** Publish an event */
  publish(event: unknown): void;
}
