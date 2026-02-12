import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
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

function createEventBusStub(): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: async () => undefined,
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
    const store = new SessionRuntimeStore(createEventBusStub(), {
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

  test("allows concurrent execution across different chat ids", async () => {
    const store = new SessionRuntimeStore(createEventBusStub(), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishTimeoutMs: 100,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const releaseA = createDeferred<void>();
    const releaseB = createDeferred<void>();
    let startedB = false;

    const first = store.runExclusive("chat-a", async () => {
      await releaseA.promise;
      return "a";
    });

    const second = store.runExclusive("chat-b", async () => {
      startedB = true;
      await releaseB.promise;
      return "b";
    });

    await flushAsync();
    expect(startedB).toBe(true);

    releaseB.resolve();
    releaseA.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe("a");
    expect(b).toBe("b");
  });

  test("fails fast when lock acquisition exceeds timeout", async () => {
    const store = new SessionRuntimeStore(createEventBusStub(), {
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

    const third = store.runExclusive("chat-1", async () => "third");

    releaseFirst.resolve();
    await expect(first).resolves.toBe("first");
    await expect(third).resolves.toBe("third");
    await expect(
      store.runExclusive("chat-1", async () => "fourth")
    ).resolves.toBe("fourth");
  });
});

describe("SessionRuntimeStore.broadcast", () => {
  test("returns successfully when event bus publish fails", async () => {
    const store = new SessionRuntimeStore(
      {
        subscribe: () => () => undefined,
        publish: () => {
          throw new Error("event bus down");
        },
      },
      {
        sessionBufferLimit: 20,
        lockAcquireTimeoutMs: 500,
        eventBusPublishTimeoutMs: 100,
        eventBusPublishMaxQueuePerChat: 8,
      }
    );
    store.set("chat-1", createSession("chat-1"));

    const event: BroadcastEvent = {
      type: "error",
      error: "boom",
    };

    await expect(store.broadcast("chat-1", event)).resolves.toBeUndefined();
  });

  test("does not wait for slow event bus publish", async () => {
    const publishRelease = createDeferred<void>();
    let publishCalls = 0;
    const store = new SessionRuntimeStore(
      {
        subscribe: () => () => undefined,
        publish: async () => {
          publishCalls += 1;
          await publishRelease.promise;
        },
      },
      {
        sessionBufferLimit: 20,
        lockAcquireTimeoutMs: 500,
        eventBusPublishTimeoutMs: 100,
        eventBusPublishMaxQueuePerChat: 8,
      }
    );
    store.set("chat-1", createSession("chat-1"));

    const event: BroadcastEvent = {
      type: "error",
      error: "boom",
    };

    await expect(store.broadcast("chat-1", event)).resolves.toBeUndefined();
    await flushAsync();
    expect(publishCalls).toBe(1);
    publishRelease.resolve();
  });

  test("drops publishes when per-chat event bus queue is full", async () => {
    const firstPublishRelease = createDeferred<void>();
    let publishCalls = 0;
    const store = new SessionRuntimeStore(
      {
        subscribe: () => () => undefined,
        publish: async () => {
          publishCalls += 1;
          if (publishCalls === 1) {
            await firstPublishRelease.promise;
          }
        },
      },
      {
        sessionBufferLimit: 20,
        lockAcquireTimeoutMs: 500,
        eventBusPublishTimeoutMs: 100,
        eventBusPublishMaxQueuePerChat: 2,
      }
    );
    store.set("chat-1", createSession("chat-1"));
    const event: BroadcastEvent = {
      type: "error",
      error: "boom",
    };

    await store.broadcast("chat-1", event);
    await store.broadcast("chat-1", event);
    await store.broadcast("chat-1", event);
    expect(publishCalls).toBe(1);

    firstPublishRelease.resolve();
    await flushAsync();
    await flushAsync();

    expect(publishCalls).toBe(2);
  });

  test("keeps publish back-pressure correct across delete and recreate of same chat id", async () => {
    const firstPublishRelease = createDeferred<void>();
    const secondPublishRelease = createDeferred<void>();
    let publishCalls = 0;
    const store = new SessionRuntimeStore(
      {
        subscribe: () => () => undefined,
        publish: async () => {
          publishCalls += 1;
          if (publishCalls === 1) {
            await firstPublishRelease.promise;
            return;
          }
          if (publishCalls === 2) {
            await secondPublishRelease.promise;
          }
        },
      },
      {
        sessionBufferLimit: 20,
        lockAcquireTimeoutMs: 500,
        eventBusPublishTimeoutMs: 100,
        eventBusPublishMaxQueuePerChat: 1,
      }
    );
    const event: BroadcastEvent = {
      type: "error",
      error: "boom",
    };

    store.set("chat-1", createSession("chat-1"));
    await store.broadcast("chat-1", event);
    await flushAsync();
    expect(publishCalls).toBe(1);

    store.delete("chat-1");
    store.set("chat-1", createSession("chat-1"));
    await store.broadcast("chat-1", event);
    await flushAsync();
    expect(publishCalls).toBe(2);

    firstPublishRelease.resolve();
    await flushAsync();
    await flushAsync();

    await store.broadcast("chat-1", event);
    await flushAsync();
    expect(publishCalls).toBe(2);

    secondPublishRelease.resolve();
    await flushAsync();
    await flushAsync();

    await store.broadcast("chat-1", event);
    await flushAsync();
    expect(publishCalls).toBe(3);
  });
});
