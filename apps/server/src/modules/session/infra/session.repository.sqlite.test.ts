import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";
import { closeSqliteStorage } from "@/platform/storage/sqlite-db";
import { resetStoragePathCacheForTests } from "@/platform/storage/storage-path";
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
    ).rejects.toMatchObject({
      name: "ConflictError",
      code: "CONFLICT",
    });

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(page.messages).toHaveLength(0);
  });

  test("truncates oversized message payloads instead of rejecting create", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-create-truncates-oversized-message";
    const base = Date.now();
    const oversizedContent = "x".repeat(2 * 1024 * 1024 + 1);

    await repo.create(
      createSession(
        chatId,
        [createMessage("m-oversized", "assistant", oversizedContent, base)],
        base
      )
    );

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 10,
      includeCompacted: true,
    });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.isCompacted).toBe(true);
    expect(page.messages[0]?.content.length).toBeGreaterThan(0);
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

  test("replaces stored message snapshot on replaceMessages", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-replace-messages";
    const base = Date.now();

    await repo.create(
      createSession(
        chatId,
        [
          createMessage("m-old-1", "user", "old-1", base - 20),
          createMessage("m-old-2", "assistant", "old-2", base - 10),
        ],
        base
      )
    );

    await repo.replaceMessages(chatId, "user-1", [
      createMessage("m-new-1", "user", "new-1", base + 10),
      createMessage("m-new-2", "assistant", "new-2", base + 20),
    ]);

    const page = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(page.messages.map((message) => message.id)).toEqual([
      "m-new-1",
      "m-new-2",
    ]);
    expect(page.messages.map((message) => message.content)).toEqual([
      "new-1",
      "new-2",
    ]);
  });

  test("supports backward message pagination with chronological page order", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-backward-pagination";
    const base = Date.now();

    await repo.create(createSession(chatId, [], base));
    for (let index = 1; index <= 5; index += 1) {
      await repo.appendMessage(
        chatId,
        "user-1",
        createMessage(`m-${index}`, "assistant", `msg-${index}`, base + index)
      );
    }

    const firstPage = await repo.getMessagesPage(chatId, "user-1", {
      limit: 2,
      direction: "backward",
      includeCompacted: true,
    });
    expect(firstPage.messages.map((message) => message.id)).toEqual([
      "m-4",
      "m-5",
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await repo.getMessagesPage(chatId, "user-1", {
      cursor: firstPage.nextCursor,
      limit: 2,
      direction: "backward",
      includeCompacted: true,
    });
    expect(secondPage.messages.map((message) => message.id)).toEqual([
      "m-2",
      "m-3",
    ]);
    expect(secondPage.hasMore).toBe(true);
    expect(secondPage.nextCursor).toBeDefined();

    const thirdPage = await repo.getMessagesPage(chatId, "user-1", {
      cursor: secondPage.nextCursor,
      limit: 2,
      direction: "backward",
      includeCompacted: true,
    });
    expect(thirdPage.messages.map((message) => message.id)).toEqual(["m-1"]);
    expect(thirdPage.hasMore).toBe(false);
    expect(thirdPage.nextCursor).toBeUndefined();
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
