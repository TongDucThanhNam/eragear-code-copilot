import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import {
  enqueueSqliteWrite,
  getSqliteWriteQueueStats,
} from "./sqlite-write-queue";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("sqlite-write-queue", () => {
  test("serializes high-priority writes in enqueue order", async () => {
    const order: string[] = [];

    const first = enqueueSqliteWrite("test.serial.1", async () => {
      order.push("first-start");
      await sleep(20);
      order.push("first-end");
      return 1;
    });
    const second = enqueueSqliteWrite("test.serial.2", () => {
      order.push("second-start");
      order.push("second-end");
      return 2;
    });

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
    expect(getSqliteWriteQueueStats().pending).toBe(0);
  });

  test("prioritizes high-priority writes before low-priority writes", async () => {
    const order: string[] = [];

    const low = enqueueSqliteWrite(
      "test.priority.low",
      () => {
        order.push("low");
        return "low";
      },
      { priority: "low" }
    );

    const high = enqueueSqliteWrite(
      "test.priority.high",
      () => {
        order.push("high");
        return "high";
      },
      { priority: "high" }
    );

    const [lowResult, highResult] = await Promise.all([low, high]);
    expect(lowResult).toBe("low");
    expect(highResult).toBe("high");
    expect(order).toEqual(["high", "low"]);
  });

  test("exposes lane-aware pending queue stats", async () => {
    const gate = createDeferred();

    const high = enqueueSqliteWrite("test.stats.high", async () => {
      await gate.promise;
      return "high";
    });

    const low = enqueueSqliteWrite("test.stats.low", async () => "low", {
      priority: "low",
    });

    await sleep(5);
    const pendingStats = getSqliteWriteQueueStats();
    expect(pendingStats.pending).toBe(2);
    expect(pendingStats.writeQueueDepth).toBe(2);
    expect(pendingStats.pendingTotal).toBe(2);
    expect(pendingStats.pendingHigh).toBe(1);
    expect(pendingStats.pendingLow).toBe(1);

    gate.resolve();
    await Promise.all([high, low]);

    const settledStats = getSqliteWriteQueueStats();
    expect(settledStats.pending).toBe(0);
    expect(settledStats.pendingHigh).toBe(0);
    expect(settledStats.pendingLow).toBe(0);
  });

  test("retries SQLITE_BUSY failures", async () => {
    const originalMaxRetries = ENV.sqliteBusyMaxRetries;
    const originalBaseDelay = ENV.sqliteBusyRetryBaseDelayMs;
    ENV.sqliteBusyMaxRetries = 4;
    ENV.sqliteBusyRetryBaseDelayMs = 1;

    let attempts = 0;
    try {
      const result = await enqueueSqliteWrite("test.busy.retry", () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return "ok";
      });
      expect(result).toBe("ok");
      expect(attempts).toBe(3);
    } finally {
      ENV.sqliteBusyMaxRetries = originalMaxRetries;
      ENV.sqliteBusyRetryBaseDelayMs = originalBaseDelay;
    }
  });

  test("does not block high-priority writes while busy retry is delayed", async () => {
    const originalMaxRetries = ENV.sqliteBusyMaxRetries;
    const originalBaseDelay = ENV.sqliteBusyRetryBaseDelayMs;
    ENV.sqliteBusyMaxRetries = 3;
    ENV.sqliteBusyRetryBaseDelayMs = 20;

    const order: string[] = [];
    let lowAttempts = 0;
    try {
      const low = enqueueSqliteWrite(
        "test.busy.low",
        () => {
          lowAttempts += 1;
          order.push(`low-${lowAttempts}`);
          if (lowAttempts === 1) {
            throw new Error("SQLITE_BUSY: database is locked");
          }
          return "low-ok";
        },
        { priority: "low" }
      );

      await sleep(1);
      const high = enqueueSqliteWrite(
        "test.busy.high",
        () => {
          order.push("high");
          return "high-ok";
        },
        { priority: "high" }
      );

      const [lowResult, highResult] = await Promise.all([low, high]);
      expect(lowResult).toBe("low-ok");
      expect(highResult).toBe("high-ok");
      expect(order).toEqual(["low-1", "high", "low-2"]);
    } finally {
      ENV.sqliteBusyMaxRetries = originalMaxRetries;
      ENV.sqliteBusyRetryBaseDelayMs = originalBaseDelay;
    }
  });
});
