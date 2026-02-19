import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV } from "@/config/environment";
import { acquireSqliteProcessInitLock } from "./sqlite-process-lock";

const LOCK_ACQUIRE_FAILED_REGEX =
  /failed to acquire sqlite initialization lock/i;

describe("sqlite-process-lock", () => {
  const originalBusyTimeoutMs = ENV.sqliteBusyTimeoutMs;
  const originalBusyRetryBaseDelayMs = ENV.sqliteBusyRetryBaseDelayMs;

  afterEach(() => {
    ENV.sqliteBusyTimeoutMs = originalBusyTimeoutMs;
    ENV.sqliteBusyRetryBaseDelayMs = originalBusyRetryBaseDelayMs;
  });

  test("serializes initialization while lock is held", async () => {
    ENV.sqliteBusyTimeoutMs = 50;
    ENV.sqliteBusyRetryBaseDelayMs = 5;
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    try {
      const first = await acquireSqliteProcessInitLock(storageDir);
      await expect(
        acquireSqliteProcessInitLock(storageDir)
      ).rejects.toThrowError(LOCK_ACQUIRE_FAILED_REGEX);
      await first.release();

      const second = await acquireSqliteProcessInitLock(storageDir);
      await second.release();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  test("yields between lock retries instead of blocking event loop until timeout", async () => {
    ENV.sqliteBusyTimeoutMs = 120;
    ENV.sqliteBusyRetryBaseDelayMs = 5;
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    try {
      const first = await acquireSqliteProcessInitLock(storageDir);
      let secondSettled = false;
      const blockedAcquire = acquireSqliteProcessInitLock(storageDir).finally(
        () => {
          secondSettled = true;
        }
      );

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10);
        timer.unref?.();
      });

      expect(secondSettled).toBe(false);
      await expect(blockedAcquire).rejects.toThrowError(
        LOCK_ACQUIRE_FAILED_REGEX
      );
      await first.release();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  test("release is idempotent", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    try {
      const lock = await acquireSqliteProcessInitLock(storageDir);
      await lock.release();
      expect(() => lock.release()).not.toThrow();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
