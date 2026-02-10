import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  closeSqliteStorage,
  getSqliteOrm,
  sqliteSchema,
} from "@/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "@/platform/storage/storage-path";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import { SessionSqliteRepository } from "./session.repository.sqlite";

function createMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  timestamp: number
): StoredMessage {
  return {
    id,
    role,
    content,
    timestamp,
  };
}

function createSession(
  id: string,
  messages: StoredMessage[],
  now: number
): StoredSession {
  return {
    id,
    userId: "user-1",
    projectRoot: "/tmp/project",
    status: "stopped",
    createdAt: now,
    lastActiveAt: now,
    messages,
  };
}

describe("SessionSqliteRepository.save", () => {
  let previousStorageDir: string | undefined;
  let tempStorageDir = "";

  beforeEach(async () => {
    previousStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    await closeSqliteStorage();

    tempStorageDir = await mkdtemp(
      path.join(os.tmpdir(), "eragear-session-sqlite-")
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

  test("deletes all persisted messages when saving an existing session with empty messages", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-delete";
    const base = Date.now();

    await repo.save(
      createSession(
        chatId,
        [
          createMessage("m-1", "user", "hello", base),
          createMessage("m-2", "assistant", "world", base + 1),
        ],
        base
      )
    );

    const initialPage = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(initialPage.messages.map((message) => message.id)).toEqual([
      "m-1",
      "m-2",
    ]);

    await repo.save(createSession(chatId, [], base + 10));

    const pageAfterClear = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(pageAfterClear.messages).toHaveLength(0);

    const orm = await getSqliteOrm();
    const countRow = orm
      .select({ count: sql<number>`count(*)` })
      .from(sqliteSchema.sessionMessages)
      .where(eq(sqliteSchema.sessionMessages.sessionId, chatId))
      .get();
    expect(Number(countRow?.count ?? 0)).toBe(0);
  });

  test("removes stale messages while keeping updated ones on snapshot save", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-prune";
    const base = Date.now();

    await repo.save(
      createSession(
        chatId,
        [
          createMessage("m-1", "user", "one", base),
          createMessage("m-2", "assistant", "two", base + 1),
          createMessage("m-3", "assistant", "three", base + 2),
        ],
        base
      )
    );

    await repo.save(
      createSession(
        chatId,
        [
          createMessage("m-1", "user", "one-updated", base + 10),
          createMessage("m-3", "assistant", "three", base + 11),
        ],
        base + 10
      )
    );

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(page.messages.map((message) => message.id)).toEqual(["m-1", "m-3"]);
    expect(page.messages.find((message) => message.id === "m-1")?.content).toBe(
      "one-updated"
    );
    expect(page.messages.find((message) => message.id === "m-2")).toBe(
      undefined
    );
  });
});
