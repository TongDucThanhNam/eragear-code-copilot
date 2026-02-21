import { describe, expect, test } from "bun:test";
import type {
  StoredMessage,
  StoredSession,
} from "@/modules/session/domain/stored-session.types";
import { GetSessionMessageByIdService } from "./get-session-message-by-id.service";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

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

describe("GetSessionMessageByIdService", () => {
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
    const service = new GetSessionMessageByIdService(repo);

    const result = await service.execute({
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
    const service = new GetSessionMessageByIdService(repo);

    const result = await service.execute({
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
    const service = new GetSessionMessageByIdService(repo);

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "missing-chat",
        messageId: "msg-1",
      })
    ).rejects.toThrow("Chat not found");
  });
});
