import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  enqueueSqliteWrite,
  flushSqliteWriteQueue,
  getSqliteWriteQueueStats,
  SqliteWriteQueueOverloadedError,
  setSqliteWriteQueuePolicyForTests,
} from "./sqlite-write-queue";

describe("sqlite-write-queue", () => {
  beforeEach(() => {
    setSqliteWriteQueuePolicyForTests({
      busyMaxRetries: 4,
      busyRetryBaseDelayMs: 1,
      maxPending: 256,
    });
  });

  afterEach(async () => {
    setSqliteWriteQueuePolicyForTests(null);
    await flushSqliteWriteQueue(200);
  });

  test("executes writes and drains pending counters", async () => {
    const first = enqueueSqliteWrite("test.write.1", () => "a");
    const second = enqueueSqliteWrite("test.write.2", () => "b", {
      priority: "low",
    });

    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");

    expect(getSqliteWriteQueueStats().pending).toBe(0);
    expect(getSqliteWriteQueueStats().pendingHigh).toBe(0);
    expect(getSqliteWriteQueueStats().pendingLow).toBe(0);
  });

  test("serializes overlapping writes", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = enqueueSqliteWrite("test.serial.1", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first:end");
      return "first";
    });
    const second = enqueueSqliteWrite("test.serial.2", () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["first:start"]);

    releaseFirst?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("prioritizes high-priority writes over queued low-priority writes", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = enqueueSqliteWrite("test.priority.1", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first:end");
      return "first";
    });
    const low = enqueueSqliteWrite(
      "test.priority.low",
      () => {
        order.push("low:start");
        order.push("low:end");
        return "low";
      },
      { priority: "low" }
    );
    const high = enqueueSqliteWrite("test.priority.high", () => {
      order.push("high:start");
      order.push("high:end");
      return "high";
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirst?.();

    await expect(first).resolves.toBe("first");
    await expect(high).resolves.toBe("high");
    await expect(low).resolves.toBe("low");
    expect(order).toEqual([
      "first:start",
      "first:end",
      "high:start",
      "high:end",
      "low:start",
      "low:end",
    ]);
  });

  test("retries SQLITE_BUSY operations with backoff", async () => {
    let attempts = 0;
    const result = await enqueueSqliteWrite("test.busy.retry", () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(getSqliteWriteQueueStats().busyRetryCount).toBeGreaterThanOrEqual(2);
  });

  test("flush waits for in-flight writes", async () => {
    let release: (() => void) | undefined;
    const pending = enqueueSqliteWrite("test.flush.wait", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "done";
    });

    const flushPromise = flushSqliteWriteQueue(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await flushPromise).toBe(false);

    release?.();
    await expect(pending).resolves.toBe("done");
    await expect(flushSqliteWriteQueue(500)).resolves.toBe(true);
  });

  test("rejects enqueues when pending writes exceed maxPending", async () => {
    setSqliteWriteQueuePolicyForTests({
      busyMaxRetries: 4,
      busyRetryBaseDelayMs: 1,
      maxPending: 2,
    });

    let releaseFirst: (() => void) | undefined;
    const first = enqueueSqliteWrite("test.overload.1", async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return "first";
    });
    const second = enqueueSqliteWrite("test.overload.2", () => "second");
    const overloaded = enqueueSqliteWrite("test.overload.3", () => "third");

    await expect(overloaded).rejects.toBeInstanceOf(
      SqliteWriteQueueOverloadedError
    );
    expect(getSqliteWriteQueueStats().rejectedOverload).toBeGreaterThanOrEqual(
      1
    );

    releaseFirst?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
});
