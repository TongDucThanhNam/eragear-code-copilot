import { describe, expect, test } from "bun:test";
import type {
  ChatSession,
  StoredSession,
} from "#runtime/shared/types/session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import {
  RollbackConversationService,
  truncateMessagesToTurn,
} from "./rollback-conversation.service";

const SESSION: StoredSession = {
  id: "chat-1",
  userId: "user-1",
  sessionId: "stale-acp-session",
  projectId: "project-1",
  projectRoot: "C:\\repo",
  command: "agent",
  args: ["acp"],
  env: { SAFE_KEY: "value" },
  status: "running",
  createdAt: 1,
  lastActiveAt: 2,
  messages: [
    { id: "u1", role: "user", content: "one", timestamp: 1 },
    { id: "a1", role: "assistant", content: "first", timestamp: 2 },
    { id: "u2", role: "user", content: "two", timestamp: 3 },
    { id: "a2", role: "assistant", content: "second", timestamp: 4 },
  ],
};

describe("truncateMessagesToTurn", () => {
  test("retains complete messages through the requested user turn", () => {
    expect(
      truncateMessagesToTurn(SESSION.messages, 1).map((item) => item.id)
    ).toEqual(["u1", "a1"]);
    expect(truncateMessagesToTurn(SESSION.messages, 0)).toEqual([]);
  });
});

describe("RollbackConversationService", () => {
  test("stops, truncates, clears stale ACP identity, and starts a fresh runtime", async () => {
    const calls: string[] = [];
    let replaced = SESSION.messages;
    let metadata: Partial<StoredSession> | undefined;
    let createInput: unknown;
    let broadcast: unknown;
    const repo = {
      findById: () => Promise.resolve(SESSION),
      replaceMessages: (
        _id: string,
        _userId: string,
        messages: typeof replaced
      ) => {
        calls.push("replace");
        replaced = messages;
        return Promise.resolve({ replaced: true as const });
      },
      updateMetadata: (
        _id: string,
        _userId: string,
        updates: Partial<StoredSession>
      ) => {
        calls.push("metadata");
        metadata = updates;
        return Promise.resolve();
      },
    } as unknown as SessionRepositoryPort;
    const service = new RollbackConversationService(
      repo,
      {
        execute: () => {
          calls.push("stop");
          return Promise.resolve({ ok: true });
        },
      },
      {
        execute: (input) => {
          calls.push("create");
          createInput = input;
          return Promise.resolve({} as ChatSession);
        },
      },
      {
        broadcast: (_chatId, event) => {
          calls.push("broadcast");
          broadcast = event;
          return Promise.resolve();
        },
      }
    );

    await expect(
      service.execute({
        userId: "user-1",
        sessionId: "chat-1",
        projectRoot: "C:\\repo",
        turnCount: 1,
      })
    ).resolves.toEqual({ replayedMessages: 2 });

    expect(calls).toEqual([
      "stop",
      "replace",
      "metadata",
      "create",
      "broadcast",
    ]);
    expect(replaced.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(metadata).toEqual({ sessionId: undefined, status: "stopped" });
    expect(createInput).toMatchObject({
      chatId: "chat-1",
      projectRoot: "C:\\repo",
      importExternalHistoryOnLoad: false,
    });
    expect(createInput).not.toHaveProperty("sessionIdToLoad");
    expect(broadcast).toEqual({
      type: "session_reverted",
      turnCount: 1,
      replayedMessages: 2,
    });
  });
});
