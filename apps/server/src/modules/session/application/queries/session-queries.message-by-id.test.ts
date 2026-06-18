import { describe, expect, test } from "bun:test";
import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";
import type { SessionRepositoryPort } from "../ports/session-repository.port";
import { SessionQueries } from "./session-queries";

function createStoredSession(id: string, userId: string): StoredSession {
  const now = Date.now();
  return {
    id,
    userId,
    projectRoot: "/tmp/project",
    status: "running",
    createdAt: now,
    lastActiveAt: now,
    messages: [],
  };
}

describe("SessionQueries.messageById", () => {
  test("returns mapped message when it exists", async () => {
    const repo = {
      findById: async () => createStoredSession("chat-1", "user-1"),
      getMessageById: async (): Promise<StoredMessage> => ({
        id: "msg-1",
        role: "user",
        content: "hello",
        contentBlocks: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      }),
    } as unknown as SessionRepositoryPort;
    const queries = new SessionQueries(repo);

    const result = await queries.messageById({
      userId: "user-1",
      chatId: "chat-1",
      messageId: "msg-1",
    });

    expect(result.message).toBeDefined();
    expect(result.message?.id).toBe("msg-1");
    expect(result.message?.role).toBe("user");
    expect(result.message?.parts.length).toBeGreaterThan(0);
  });

  test("returns undefined when message is missing", async () => {
    const repo = {
      findById: async () => createStoredSession("chat-1", "user-1"),
      getMessageById: async () => undefined,
    } as unknown as SessionRepositoryPort;
    const queries = new SessionQueries(repo);

    const result = await queries.messageById({
      userId: "user-1",
      chatId: "chat-1",
      messageId: "missing-message",
    });

    expect(result).toEqual({ message: undefined });
  });

  test("throws when chat is not found", async () => {
    const repo = {
      findById: async () => undefined,
      getMessageById: async () => undefined,
    } as unknown as SessionRepositoryPort;
    const queries = new SessionQueries(repo);

    await expect(
      queries.messageById({
        userId: "user-1",
        chatId: "missing-chat",
        messageId: "msg-1",
      })
    ).rejects.toThrow("Chat not found");
  });
});
