import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionEventOutboxPort } from "@/modules/session/application/ports/session-event-outbox.port";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SessionRuntimeStore } from "./runtime-store";

const LOCK_TIMEOUT_RE = /Lock acquisition timed out/;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createOutboxStub(calls: BroadcastEvent[]): SessionEventOutboxPort {
  return {
    enqueue: async (input) => {
      await calls.push(input.event);
    },
    dispatch: async () => ({
      dispatched: 0,
      failed: 0,
      retried: 0,
      pending: 0,
    }),
  };
}

function createFailingOutboxStub(): SessionEventOutboxPort {
  return {
    enqueue: () => {
      throw new Error("outbox failure");
    },
    dispatch: async () => ({
      dispatched: 0,
      failed: 0,
      retried: 0,
      pending: 0,
    }),
  };
}

function createSession(chatId = "chat-1"): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SessionRuntimeStore.runExclusive", () => {
  test("serializes execution per chat id", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const order: string[] = [];

    const first = store.runExclusive("chat-1", async () => {
      order.push("first:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("first:end");
      return "first";
    });

    await firstStarted.promise;

    const second = store.runExclusive("chat-1", () => {
      order.push("second:start");
      return Promise.resolve("second");
    });

    await flushAsync();
    expect(order).toEqual(["first:start"]);

    releaseFirst.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe("first");
    expect(secondResult).toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("fails fast when lock acquisition exceeds timeout", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 20,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();

    const first = store.runExclusive("chat-1", async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return "first";
    });

    await firstStarted.promise;

    await expect(
      store.runExclusive("chat-1", async () => "second")
    ).rejects.toThrow(LOCK_TIMEOUT_RE);

    releaseFirst.resolve();
    await expect(first).resolves.toBe("first");
  });
});

describe("SessionRuntimeStore.delete", () => {
  test("cancels pending permissions before removing runtime session", () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const session = createSession("chat-1");
    const decisions: unknown[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: (decision: unknown) => {
        decisions.push(decision);
      },
      options: [],
    });
    store.set("chat-1", session);

    store.delete("chat-1");

    expect(session.pendingPermissions.size).toBe(0);
    expect(decisions).toEqual([{ outcome: { outcome: "cancelled" } }]);
    expect(store.has("chat-1")).toBe(false);
  });
});

describe("SessionRuntimeStore.broadcast", () => {
  test("buffers events and persists durable outbox records", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 3,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);

    const events: BroadcastEvent[] = [
      { type: "error", error: "e-1" },
      { type: "error", error: "e-2" },
      { type: "error", error: "e-3" },
      { type: "error", error: "e-4" },
    ];

    for (const event of events) {
      await store.broadcast("chat-1", event);
    }

    expect(session.messageBuffer).toEqual(events.slice(1));
    expect(outboxCalls).toEqual(events);
  });

  test("handles concurrent broadcast bursts without corrupting message buffer", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);

    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.broadcast("chat-1", {
          type: "error",
          error: `e-${index}`,
        })
      )
    );

    expect(session.messageBuffer.length).toBe(10);
    expect(session.messageBuffer).toEqual(
      Array.from({ length: 10 }, (_, offset) => ({
        type: "error",
        error: `e-${90 + offset}`,
      }))
    );
    expect(outboxCalls.length).toBe(100);
  });

  test("does not emit or buffer event when outbox enqueue fails", async () => {
    const store = new SessionRuntimeStore(createFailingOutboxStub(), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);
    const received: BroadcastEvent[] = [];
    session.emitter.on("data", (event) => {
      received.push(event as BroadcastEvent);
    });

    await expect(
      store.broadcast("chat-1", {
        type: "error",
        error: "e-1",
      })
    ).rejects.toThrow(/outbox failure/);
    expect(received).toEqual([]);
    expect(session.messageBuffer).toEqual([]);
  });
});
