import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV } from "@/config/environment";
import {
  resetStoragePathCacheForTests,
  setStorageFsTypeOverrideForTests,
} from "@/platform/storage/storage-path";
import type { LogEntry } from "@/shared/types/log.types";
import { LogStore } from "./log-store";

const LOCAL_FS_TYPE = 0xef_53;

describe("LogStore persisted history", () => {
  const previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
  const previousLogFileEnabled = ENV.logFileEnabled;
  const previousLogFlushIntervalMs = ENV.logFlushIntervalMs;

  afterEach(() => {
    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }
    ENV.logFileEnabled = previousLogFileEnabled;
    ENV.logFlushIntervalMs = previousLogFlushIntervalMs;
    resetStoragePathCacheForTests();
  });

  test("queries persisted files alongside the in-memory buffer", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-logs-"));
    process.env.ERAGEAR_STORAGE_DIR = storageDir;
    ENV.logFileEnabled = true;
    ENV.logFlushIntervalMs = 1;
    resetStoragePathCacheForTests();
    setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

    const logDir = path.join(storageDir, "logs");
    await mkdir(logDir, { recursive: true });

    const persistedEntry: LogEntry = {
      id: "log-persisted",
      timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
      level: "info",
      message: "persisted history",
      meta: { worker: "sqlite" },
    };
    const persistedDate = new Date(persistedEntry.timestamp)
      .toISOString()
      .slice(0, 10);
    await writeFile(
      path.join(logDir, `logs-${persistedDate}.ndjson`),
      `${JSON.stringify(persistedEntry)}\n`,
      "utf-8"
    );

    const store = new LogStore({ maxEntries: 1 });
    store.append({
      id: "log-live",
      timestamp: Date.now(),
      level: "warn",
      message: "live buffer entry",
    });

    const result = await store.query({
      from: Date.now() - 7 * 24 * 60 * 60 * 1000,
      order: "desc",
      limit: 10,
    });

    expect(result.stats.total).toBe(2);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "log-live",
      "log-persisted",
    ]);
  });

  test("includes metadata in persisted history search", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-logs-"));
    process.env.ERAGEAR_STORAGE_DIR = storageDir;
    ENV.logFileEnabled = true;
    ENV.logFlushIntervalMs = 1;
    resetStoragePathCacheForTests();
    setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

    const logDir = path.join(storageDir, "logs");
    await mkdir(logDir, { recursive: true });

    const persistedEntry: LogEntry = {
      id: "log-meta",
      timestamp: Date.now() - 24 * 60 * 60 * 1000,
      level: "info",
      message: "background worker ready",
      meta: { queue: "sqlite-writes" },
    };
    const persistedDate = new Date(persistedEntry.timestamp)
      .toISOString()
      .slice(0, 10);
    await writeFile(
      path.join(logDir, `logs-${persistedDate}.ndjson`),
      `${JSON.stringify(persistedEntry)}\n`,
      "utf-8"
    );

    const store = new LogStore({ maxEntries: 1 });
    const result = await store.query({
      search: "sqlite-writes",
      from: Date.now() - 7 * 24 * 60 * 60 * 1000,
    });

    expect(result.stats.total).toBe(1);
    expect(result.entries[0]?.id).toBe("log-meta");
  });

  test("persists entries under the entry timestamp day so bounded history remains queryable", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-logs-"));
    process.env.ERAGEAR_STORAGE_DIR = storageDir;
    ENV.logFileEnabled = true;
    ENV.logFlushIntervalMs = 1;
    resetStoragePathCacheForTests();
    setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

    const store = new LogStore({ maxEntries: 1 });
    const entryTimestamp = Date.parse("2026-03-07T23:59:59.900Z");
    store.append({
      id: "log-boundary",
      timestamp: entryTimestamp,
      level: "info",
      message: "before midnight",
      userId: "user-1",
    });
    await store.flush();

    const logDir = path.join(storageDir, "logs");
    const expectedDate = "2026-03-07";
    // biome-ignore lint/correctness/noUndeclaredVariables: Bun.file is a Bun-specific API for reading files
    const content = await Bun.file(
      path.join(logDir, `logs-${expectedDate}.ndjson`)
    ).text();

    expect(content).toContain("log-boundary");

    const freshStore = new LogStore({ maxEntries: 1 });
    const result = await freshStore.query({
      userId: "user-1",
      to: Date.parse("2026-03-07T23:59:59.999Z"),
    });

    expect(result.entries.map((entry) => entry.id)).toEqual(["log-boundary"]);
  });

  test("ignores persisted entries with invalid log levels", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "eragear-logs-"));
    process.env.ERAGEAR_STORAGE_DIR = storageDir;
    ENV.logFileEnabled = true;
    ENV.logFlushIntervalMs = 1;
    resetStoragePathCacheForTests();
    setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

    const logDir = path.join(storageDir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(
      path.join(logDir, "logs-2026-03-07.ndjson"),
      `${JSON.stringify({
        id: "log-invalid",
        timestamp: Date.parse("2026-03-07T12:00:00.000Z"),
        level: "fatal",
        message: "should be ignored",
        userId: "user-1",
      })}\n`,
      "utf-8"
    );

    const store = new LogStore({ maxEntries: 1 });
    const result = await store.query({
      userId: "user-1",
      from: Date.parse("2026-03-07T00:00:00.000Z"),
    });

    expect(result.entries).toEqual([]);
    expect(result.stats.levels).toEqual({
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    });
  });
});
