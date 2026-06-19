import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "#runtime/platform/storage/storage-path";
import type {
  SessionBroadcastNotification,
  SessionBroadcastNotifier,
} from "../application/session-broadcast.notifier";
import { SessionEventOutboxSqliteAdapter } from "./session-event-outbox.sqlite";

function createRecordingNotifier(
  calls: SessionBroadcastNotification[]
): SessionBroadcastNotifier {
  return {
    broadcast(input) {
      calls.push(input);
      return Promise.resolve();
    },
  };
}

describe("SessionEventOutboxSqliteAdapter", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();

    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-session-outbox-")
    );
    process.env.ERAGEAR_STORAGE_DIR = tempStorageDir;
    resetStoragePathCacheForTests();
  });

  afterEach(async () => {
    await closeSqliteStorage();
    resetStoragePathCacheForTests();

    if (previousStorageDir === undefined) {
      Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
    } else {
      process.env.ERAGEAR_STORAGE_DIR = previousStorageDir;
    }

    if (tempStorageDir) {
      await rm(tempStorageDir, { recursive: true, force: true });
    }
  });

  test("dispatches due session broadcast events through the configured notifier", async () => {
    const calls: SessionBroadcastNotification[] = [];
    const outbox = new SessionEventOutboxSqliteAdapter({
      broadcastNotifier: createRecordingNotifier(calls),
    });

    await outbox.enqueue({
      chatId: "chat-1",
      userId: "user-1",
      event: {
        type: "error",
        error: "hello",
      },
    });

    const result = await outbox.dispatchDue({
      batchSize: 10,
      publishTimeoutMs: 1000,
      maxAttempts: 3,
    });

    expect(result).toEqual({
      dispatched: 1,
      failed: 0,
      retried: 0,
      pending: 0,
    });
    expect(calls).toEqual([
      {
        chatId: "chat-1",
        userId: "user-1",
        event: {
          type: "error",
          error: "hello",
        },
      },
    ]);
  });
});
