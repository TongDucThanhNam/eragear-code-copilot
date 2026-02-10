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

const APPEND_MESSAGE_REGEX = /appendMessage/i;

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

  test("creates initial session metadata with empty messages", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-initial-empty";
    const base = Date.now();

    await repo.save(createSession(chatId, [], base));

    const pageAfterClear = await repo.getMessagesPage(chatId, "user-1", {
      limit: 50,
      includeCompacted: true,
    });
    expect(pageAfterClear.messages).toHaveLength(0);
  });

  test("rejects message snapshots when saving existing sessions", async () => {
    const repo = new SessionSqliteRepository();
    const chatId = "chat-save-existing-rejects-snapshot";
    const base = Date.now();

    await repo.save(createSession(chatId, [], base));

    await expect(
      repo.save(
        createSession(
          chatId,
          [createMessage("m-1", "assistant", "snapshot", base + 10)],
          base + 10
        )
      )
    ).rejects.toThrow(APPEND_MESSAGE_REGEX);

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

    await repo.save(createSession(chatId, [], base));
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

    await repo.save(createSession(targetChatId, [], base));
    await repo.save(createSession(untouchedChatId, [], base));
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
});
