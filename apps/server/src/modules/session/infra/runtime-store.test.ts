import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import { SessionRuntimeStore } from "./runtime-store";

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

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SessionRuntimeStore.runExclusive", () => {
  test("serializes execution per chat id", async () => {
    const store = new SessionRuntimeStore(createEventBusStub(), {
      sessionBufferLimit: 20,
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
});
