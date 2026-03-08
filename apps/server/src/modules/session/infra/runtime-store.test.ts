import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionEventOutboxPort } from "@/modules/session/application/ports/session-event-outbox.port";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SessionRuntimeStore } from "./runtime-store";

const OUTBOX_FAILURE_RE = /outbox failure/;

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

function getFirstTextPartText(event: BroadcastEvent): string | null {
  if (event.type !== "ui_message") {
    return null;
  }
  const firstTextPart = event.message.parts.find((part) => part.type === "text");
  if (!firstTextPart || firstTextPart.type !== "text") {
    return null;
  }
  return firstTextPart.text;
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

  test("queues pending mutations instead of timing out under lock contention", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 20,
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

    const second = store.runExclusive("chat-1", async () => "second");

    releaseFirst.resolve();
    await expect(second).resolves.toBe("second");
    await expect(first).resolves.toBe("first");
  });

  test("applies backpressure when pending mutation queue reaches per-chat limit", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 1,
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
    await expect(second).resolves.toBe("second");
    await expect(first).resolves.toBe("first");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("allows re-entrant lock acquisition for the same chat within one async flow", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 20,
      eventBusPublishMaxQueuePerChat: 1,
    });
    const order: string[] = [];

    const result = await store.runExclusive("chat-1", async () => {
      order.push("outer:start");
      await store.runExclusive("chat-1", () => {
        order.push("inner:start");
        return Promise.resolve();
      });
      order.push("outer:end");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(order).toEqual(["outer:start", "inner:start", "outer:end"]);
  });

  test("awaits async live subscribers before completing broadcast", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 20,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const session = createSession("chat-async-subscriber");
    const releaseListener = createDeferred<void>();
    let delivered = false;
    session.emitter.on("data", async () => {
      await releaseListener.promise;
      delivered = true;
    });
    session.subscriberCount = session.emitter.listenerCount("data");
    store.set(session.id, session);

    const broadcastPromise = store.broadcast(session.id, {
      type: "terminal_output",
      terminalId: "term-1",
      data: "hello",
    });
    await flushAsync();

    expect(delivered).toBe(false);
    releaseListener.resolve();
    await broadcastPromise;
    expect(delivered).toBe(true);
  });

  test("processes queued mutations in-order under sustained contention", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 20,
      eventBusPublishMaxQueuePerChat: 256,
    });
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const executionOrder: number[] = [];

    const first = store.runExclusive("chat-1", async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return -1;
    });
    await firstStarted.promise;

    const queued = Array.from({ length: 64 }, (_, index) =>
      store.runExclusive("chat-1", () => {
        executionOrder.push(index);
        return Promise.resolve(index);
      })
    );

    releaseFirst.resolve();
    await expect(first).resolves.toBe(-1);
    await expect(Promise.all(queued)).resolves.toEqual(
      Array.from({ length: 64 }, (_, index) => index)
    );
    expect(executionOrder).toEqual(
      Array.from({ length: 64 }, (_, index) => index)
    );
  });
});

describe("SessionRuntimeStore.delete", () => {
  test("cancels pending permissions before removing runtime session", () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
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

  test("deleteIfMatch removes only when object identity matches", () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const original = createSession("chat-1");
    const replacement = createSession("chat-1");
    store.set("chat-1", replacement);

    const deleted = store.deleteIfMatch("chat-1", original);

    expect(deleted).toBe(false);
    expect(store.get("chat-1")).toBe(replacement);
  });

  test("deleteIfMatch removes and cancels pending permissions for matching session", () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
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

    const deleted = store.deleteIfMatch("chat-1", session);

    expect(deleted).toBe(true);
    expect(decisions).toEqual([{ outcome: { outcome: "cancelled" } }]);
    expect(store.has("chat-1")).toBe(false);
  });

  test("preserves live emitter channel across session replacement when subscribers exist", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const original = createSession("chat-1");
    original.subscriberCount = 1;
    const received: BroadcastEvent[] = [];
    original.emitter.on("data", (event) => {
      received.push(event as BroadcastEvent);
    });
    store.set("chat-1", original);

    const deleted = store.deleteIfMatch("chat-1", original);
    expect(deleted).toBe(true);
    expect(store.has("chat-1")).toBe(false);

    const replacement = createSession("chat-1");
    const replacementEmitter = replacement.emitter;
    store.set("chat-1", replacement);

    const active = store.get("chat-1");
    expect(active).toBeDefined();
    expect(active?.emitter).toBe(original.emitter);
    expect(active?.emitter).not.toBe(replacementEmitter);
    expect(active?.subscriberCount).toBe(1);

    await store.broadcast("chat-1", {
      type: "error",
      error: "from-replacement",
    });

    expect(received).toEqual([{ type: "error", error: "from-replacement" }]);
  });

  test("does not preserve emitter channel when there are no subscribers", () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 20,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 8,
    });
    const original = createSession("chat-1");
    const originalEmitter = original.emitter;
    store.set("chat-1", original);

    const deleted = store.deleteIfMatch("chat-1", original);
    expect(deleted).toBe(true);

    const replacement = createSession("chat-1");
    const replacementEmitter = replacement.emitter;
    store.set("chat-1", replacement);

    const active = store.get("chat-1");
    expect(active).toBeDefined();
    expect(active?.emitter).toBe(replacementEmitter);
    expect(active?.emitter).not.toBe(originalEmitter);
  });
});

describe("SessionRuntimeStore.broadcast", () => {
  test("supports broadcast calls from inside an active chat lock", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);

    await store.runExclusive("chat-1", async () => {
      await store.broadcast("chat-1", {
        type: "error",
        error: "inside-lock",
      });
    });

    expect(outboxCalls).toEqual([{ type: "error", error: "inside-lock" }]);
    expect(session.messageBuffer).toEqual([
      { type: "error", error: "inside-lock" },
    ]);
  });

  test("buffers events and persists durable outbox records", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 3,
      lockAcquireTimeoutMs: 500,
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
      eventBusPublishMaxQueuePerChat: 200,
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
    ).rejects.toThrow(OUTBOX_FAILURE_RE);
    expect(received).toEqual([]);
    expect(session.messageBuffer).toEqual([]);
  });

  test("supports ephemeral part broadcasts that skip outbox and replay buffer", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);
    const received: BroadcastEvent[] = [];
    session.emitter.on("data", (event) => {
      received.push(event as BroadcastEvent);
    });

    await store.broadcast(
      "chat-1",
      {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "hello", state: "streaming" },
        isNew: true,
      },
      {
        durable: false,
        retainInBuffer: false,
      }
    );

    expect(outboxCalls).toEqual([]);
    expect(session.messageBuffer).toEqual([]);
    expect(received).toEqual([
      {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "hello", state: "streaming" },
        isNew: true,
      },
    ]);
  });

  test("defaults ui_message_part to non-durable but replay-buffered", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);
    const received: BroadcastEvent[] = [];
    session.emitter.on("data", (event) => {
      received.push(event as BroadcastEvent);
    });

    await store.broadcast("chat-1", {
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 0,
      part: { type: "text", text: "streaming", state: "streaming" },
      isNew: true,
    });

    expect(outboxCalls).toEqual([]);
    expect(session.messageBuffer).toEqual([
      {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "streaming", state: "streaming" },
        isNew: true,
      },
    ]);
    expect(received).toEqual([
      {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "streaming", state: "streaming" },
        isNew: true,
      },
    ]);
  });

  test("defaults ui_message_part_removed to non-durable but replay-buffered", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);
    const received: BroadcastEvent[] = [];
    session.emitter.on("data", (event) => {
      received.push(event as BroadcastEvent);
    });

    await store.broadcast("chat-1", {
      type: "ui_message_part_removed",
      messageId: "msg-1",
      messageRole: "assistant",
      partId: "tool-locations:1",
      partIndex: 1,
      part: {
        type: "data-tool-locations",
        data: {
          toolCallId: "tool-1",
          locations: [{ path: "src/example.ts", line: 1 }],
        },
      },
    });

    expect(outboxCalls).toEqual([]);
    expect(session.messageBuffer).toEqual([
      {
        type: "ui_message_part_removed",
        messageId: "msg-1",
        messageRole: "assistant",
        partId: "tool-locations:1",
        partIndex: 1,
        part: {
          type: "data-tool-locations",
          data: {
            toolCallId: "tool-1",
            locations: [{ path: "src/example.ts", line: 1 }],
          },
        },
      },
    ]);
    expect(received).toEqual(session.messageBuffer);
  });

  test("clones broadcast events across outbox, replay buffer, and listeners", async () => {
    const outboxCalls: BroadcastEvent[] = [];
    const store = new SessionRuntimeStore(createOutboxStub(outboxCalls), {
      sessionBufferLimit: 10,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 64,
    });
    const session = createSession("chat-1");
    store.set("chat-1", session);

    const listenerEvents: BroadcastEvent[] = [];
    session.emitter.on("data", (event) => {
      const typed = event as BroadcastEvent;
      listenerEvents.push(typed);
      if (typed.type === "ui_message") {
        const firstTextPart = typed.message.parts.find(
          (part) => part.type === "text"
        );
        if (firstTextPart?.type === "text") {
          firstTextPart.text = "listener-mutated";
        }
      }
    });

    const event: BroadcastEvent = {
      type: "ui_message",
      message: {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "original", state: "streaming" }],
      },
    };

    await store.broadcast("chat-1", event);

    if (event.type === "ui_message") {
      const firstTextPart = event.message.parts.find((part) => part.type === "text");
      if (firstTextPart?.type === "text") {
        firstTextPart.text = "caller-mutated";
      }
    }

    expect(getFirstTextPartText(outboxCalls[0] as BroadcastEvent)).toBe("original");
    expect(getFirstTextPartText(session.messageBuffer[0] as BroadcastEvent)).toBe(
      "original"
    );
    expect(getFirstTextPartText(event)).toBe("caller-mutated");
    expect(getFirstTextPartText(listenerEvents[0] as BroadcastEvent)).toBe(
      "listener-mutated"
    );
  });
});
