import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireSqliteProcessInitLock } from "./sqlite-process-lock";

const LOCK_FILE_NAME = "eragear.sqlite.init.lock";
const LOCK_HELD_REGEX = /held/i;
const LOCK_HELD_BY_PID_REGEX = /held by pid/i;

describe("sqlite-process-lock", () => {
  test("acquires and releases initialization lock", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    try {
      const lock = await acquireSqliteProcessInitLock(storageDir);
      await expect(
        acquireSqliteProcessInitLock(storageDir)
      ).rejects.toThrowError(LOCK_HELD_REGEX);
      await lock.release();
      const secondLock = await acquireSqliteProcessInitLock(storageDir);
      await secondLock.release();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  test("fails fast when lock owner pid is alive", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    const holder = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: "ignore",
      }
    );

    try {
      if (typeof holder.pid !== "number" || holder.pid <= 0) {
        throw new Error("Failed to spawn lock holder process");
      }
      const lockPath = path.join(storageDir, LOCK_FILE_NAME);
      await writeFile(
        lockPath,
        JSON.stringify({ pid: holder.pid, acquiredAt: Date.now() }),
        "utf8"
      );
      await expect(
        acquireSqliteProcessInitLock(storageDir)
      ).rejects.toThrowError(LOCK_HELD_BY_PID_REGEX);
    } finally {
      holder.kill("SIGTERM");
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  test("reclaims stale lock file from non-existent pid", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-lock-"));
    try {
      const lockPath = path.join(storageDir, LOCK_FILE_NAME);
      await writeFile(
        lockPath,
        JSON.stringify({ pid: 999_999_999, acquiredAt: Date.now() }),
        "utf8"
      );
      const lock = await acquireSqliteProcessInitLock(storageDir);
      await lock.release();
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
