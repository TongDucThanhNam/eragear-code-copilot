import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import {
  enqueueSqliteWrite,
  getSqliteWriteQueueStats,
} from "./sqlite-write-queue";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("sqlite-write-queue", () => {
  test("serializes writes in enqueue order", async () => {
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
});
