import { describe, expect, test } from "bun:test";
import type { BroadcastEvent } from "@/shared/types/session.types";
import {
  createSessionEventsObservable,
  createSessionReplayEvents,
} from "./session-events-observable";

function createNoopLogger() {
  return {
    debug() {
      return undefined;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createSessionReplayEvents", () => {
  test("emits connected before status and buffered events for runtime subscriptions", () => {
    const buffered: BroadcastEvent = { type: "heartbeat", ts: 1 };

    expect(
      createSessionReplayEvents({
        source: "runtime",
        chatStatus: "streaming",
        activeTurnId: "turn-1",
        bufferedEvents: [buffered],
      })
    ).toEqual([
      { type: "connected" },
      { type: "chat_status", status: "streaming", turnId: "turn-1" },
      buffered,
    ]);
  });

  test("does not emit connected for stored snapshots", () => {
    expect(
      createSessionReplayEvents({
        source: "stored",
        chatStatus: "inactive",
        bufferedEvents: [],
      })
    ).toEqual([{ type: "chat_status", status: "inactive" }]);
  });
});

describe("createSessionEventsObservable", () => {
  test("replays initial events, forwards live events, and releases on unsubscribe", async () => {
    const events: BroadcastEvent[] = [];
    let liveListener: ((event: BroadcastEvent) => void) | undefined;
    let unsubscribeCalled = 0;
    let releaseCalled = 0;
    const buffered: BroadcastEvent = { type: "heartbeat", ts: 1 };

    const observable = createSessionEventsObservable({
      chatId: "chat-1",
      userId: "user-1",
      logger: createNoopLogger(),
      service: {
        execute() {
          return Promise.resolve({
            source: "runtime" as const,
            chatStatus: "ready" as const,
            activeTurnId: "turn-1",
            bufferedEvents: [buffered],
            subscribe(listener) {
              liveListener = listener;
              return () => {
                unsubscribeCalled += 1;
              };
            },
            release() {
              releaseCalled += 1;
              return Promise.resolve();
            },
          });
        },
      },
    });

    const subscription = observable.subscribe({
      next(event) {
        events.push(event);
      },
    });
    await flushAsync();

    expect(events).toEqual([
      { type: "connected" },
      { type: "chat_status", status: "ready", turnId: "turn-1" },
      buffered,
    ]);

    liveListener?.({ type: "heartbeat", ts: 2 });
    expect(events.at(-1)).toEqual({ type: "heartbeat", ts: 2 });

    subscription.unsubscribe();
    await flushAsync();

    expect(unsubscribeCalled).toBe(1);
    expect(releaseCalled).toBe(1);
  });

  test("releases a subscription if the client unsubscribes before startup resolves", async () => {
    const deferred = createDeferred<{
      source: "runtime";
      chatStatus: "ready";
      bufferedEvents: BroadcastEvent[];
      subscribe(listener: (event: BroadcastEvent) => void): () => void;
      release(): Promise<void>;
    }>();
    let releaseCalled = 0;
    const events: BroadcastEvent[] = [];

    const subscription = createSessionEventsObservable({
      chatId: "chat-1",
      userId: "user-1",
      logger: createNoopLogger(),
      service: {
        execute: async () => deferred.promise,
      },
    }).subscribe({
      next(event) {
        events.push(event);
      },
    });

    subscription.unsubscribe();
    deferred.resolve({
      source: "runtime",
      chatStatus: "ready",
      bufferedEvents: [],
      subscribe() {
        return () => undefined;
      },
      release() {
        releaseCalled += 1;
        return Promise.resolve();
      },
    });
    await flushAsync();

    expect(events).toEqual([]);
    expect(releaseCalled).toBe(1);
  });

  test("emits a generic chat-not-found error for non-error startup failures", async () => {
    const errors: unknown[] = [];

    createSessionEventsObservable({
      chatId: "chat-1",
      userId: "user-1",
      logger: createNoopLogger(),
      service: {
        execute() {
          return Promise.reject("missing");
        },
      },
    }).subscribe({
      error(error) {
        errors.push(error);
      },
    });
    await flushAsync();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("Chat not found");
  });
});
