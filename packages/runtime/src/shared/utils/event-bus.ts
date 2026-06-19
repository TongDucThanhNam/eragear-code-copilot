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
const DEFAULT_EVENT_BUS_LISTENER_TIMEOUT_MS = 30_000;

interface EventBusLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

class EventBusListenerTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`[EventBus] Listener timed out after ${timeoutMs}ms`);
    this.name = "EventBusListenerTimeoutError";
    this.timeoutMs = timeoutMs;
  }
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
  private readonly listeners = new Map<symbol, EventBusListener>();
  private readonly logger?: EventBusLogger;
  private readonly listenerTimeoutMs: number;

  constructor(
    logger?: EventBusLogger,
    options?: {
      listenerTimeoutMs?: number;
    }
  ) {
    this.logger = logger;
    const timeoutMs = options?.listenerTimeoutMs;
    if (
      typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    ) {
      this.listenerTimeoutMs = DEFAULT_EVENT_BUS_LISTENER_TIMEOUT_MS;
      return;
    }
    this.listenerTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
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

    const listenerId = Symbol("event_bus_listener");
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
    const results = await Promise.allSettled(
      listeners.map(async (listener) => {
        await this.callListenerWithTimeout(listener, event);
      })
    );
    let failedListeners = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        continue;
      }
      failedListeners += 1;
      const errorDetails = toEventBusErrorDetails(result.reason);
      this.logger?.error("[EventBus] Listener error", {
        eventType: event.type,
        error: errorDetails.message,
        errorName: errorDetails.name,
        errorStack: errorDetails.stack,
        timeout:
          result.reason instanceof EventBusListenerTimeoutError
            ? result.reason.timeoutMs
            : undefined,
      });
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

  private async callListenerWithTimeout(
    listener: EventBusListener,
    event: DomainEvent
  ): Promise<void> {
    const abortController = new AbortController();
    const listenerPromise = Promise.resolve().then(() =>
      listener(event, { signal: abortController.signal })
    );
    listenerPromise.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        abortController.abort();
        reject(new EventBusListenerTimeoutError(this.listenerTimeoutMs));
      }, this.listenerTimeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([listenerPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) {
        await Promise.race([
          listenerPromise.catch(() => undefined),
          new Promise((resolve) => {
            const settleTimer = setTimeout(resolve, 50);
            settleTimer.unref?.();
          }),
        ]);
      }
      throw error;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function toEventBusErrorDetails(reason: unknown): {
  message: string;
  name?: string;
  stack?: string;
} {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      name: reason.name,
      stack: reason.stack,
    };
  }
  return {
    message: String(reason),
  };
}
