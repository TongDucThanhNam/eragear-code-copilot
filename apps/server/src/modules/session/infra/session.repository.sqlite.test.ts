import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSqliteStorage } from "@/platform/storage/sqlite-db";
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

describe("SessionSqliteRepository.create", () => {
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

  test("creates initial session metadata with empty messages", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-initial-empty";
    const base = Date.now();

    await repo.create(createSession(chatId, [], base));

    const pageAfterClear = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(pageAfterClear.messages).toHaveLength(0);
  });

  test("rejects duplicate session create for the same id", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-create-rejects-duplicate";
    const base = Date.now();

    await repo.create(createSession(chatId, [], base));

    await expect(
      repo.create(createSession(chatId, [], base + 10))
    ).rejects.toThrow();

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(page.messages).toHaveLength(0);
  });

  test("persists messages through appendMessage after initial save", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-append-message";
    const base = Date.now();

    await repo.create(createSession(chatId, [], base));
    await repo.appendMessage(
      chatId,
      "user-1",
      createMessage("m-1", "assistant", "hello", base + 1)
    );

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(page.messages.map((message) => message.id)).toEqual(["m-1"]);
    expect(page.messages[0]?.content).toBe("hello");
  });

  test("throws NotFoundError when appendMessage targets missing session", async () => {
    const repo = new SessionSqliteRepository();

    await expect(
      repo.appendMessage(
        "missing-chat",
        "user-1",
        createMessage("m-1", "assistant", "hello", Date.now())
      )
    ).rejects.toMatchObject({
      name: "NotFoundError",
      code: "NOT_FOUND",
    });
  });

  test("compacts only explicitly targeted session IDs", async () => {
    const repo = new SessionSqliteRepository();
    const targetChatId = "chat-compact-target";
    const untouchedChatId = "chat-compact-untouched";
    const base = Date.now();

    await repo.create(createSession(targetChatId, [], base));
    await repo.create(createSession(untouchedChatId, [], base));
    await repo.updateStatus(targetChatId, "user-1", "running");

    await repo.appendMessage(
      targetChatId,
      "user-1",
      createMessage("m-target", "assistant", "target-content", base - 1000)
    );
    await repo.appendMessage(
      untouchedChatId,
      "user-1",
      createMessage(
        "m-untouched",
        "assistant",
        "untouched-content",
        base - 1000
      )
    );

    const result = await repo.compactMessages({
      beforeTimestamp: base,
      batchSize: 10,
      sessionIds: [targetChatId],
    });
    expect(result.compacted).toBe(1);

    const targetPage = await repo.getMessagesPage(targetChatId, "user-1", {
      limit: 10,
      includeCompacted: true,
    });
    expect(targetPage.messages).toHaveLength(1);
    expect(targetPage.messages[0]?.isCompacted).toBe(true);
    expect(targetPage.messages[0]?.content).toBe("");

    const untouchedPage = await repo.getMessagesPage(
      untouchedChatId,
      "user-1",
      {
        limit: 10,
        includeCompacted: true,
      }
    );
    expect(untouchedPage.messages).toHaveLength(1);
    expect(untouchedPage.messages[0]?.isCompacted).toBe(false);
    expect(untouchedPage.messages[0]?.content).toBe("untouched-content");
  });

  test("compacts without SQLite bind-limit failures for large sessionId sets", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-compact-large-id-set";
    const base = Date.now();

    await repo.create(createSession(chatId, [], base));
    await repo.appendMessage(
      chatId,
      "user-1",
      createMessage("m-large", "assistant", "payload", base - 5000)
    );

    const largeSessionIds = [
      chatId,
      ...Array.from({ length: 1200 }, (_, index) => `ghost-session-${index}`),
    ];
    const result = await repo.compactMessages({
      beforeTimestamp: base,
      batchSize: 10,
      sessionIds: largeSessionIds,
    });

    expect(result.compacted).toBe(1);
    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 10,
      includeCompacted: true,
    });
    expect(page.messages[0]?.isCompacted).toBe(true);
  });

  test("paginates sessions via cursor with stable ordering", async () => {
    const repo = new SessionSqliteRepository();
    const base = Date.now();

    await repo.create(createSession("chat-c", [], base));
    await repo.create(createSession("chat-b", [], base));
    await repo.create(createSession("chat-a", [], base - 1));

    const firstPage = await repo.findPage("user-1", { limit: 2 });
    expect(firstPage.sessions).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await repo.findPage("user-1", {
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.sessions).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeUndefined();

    const allIds = [...firstPage.sessions, ...secondPage.sessions].map(
      (session) => session.id
    );
    expect(new Set(allIds).size).toBe(3);
  });
});
