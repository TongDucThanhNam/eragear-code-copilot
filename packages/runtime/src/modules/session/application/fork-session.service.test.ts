import { describe, expect, test } from "bun:test";
import type { StoredSession } from "../domain/stored-session.types";
import { ForkSessionService } from "./fork-session.service";
import type {
  SessionBindingPort,
  SessionForkBinding,
} from "./ports/session-binding.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

class SessionBindingStub implements SessionBindingPort {
  readonly forks: SessionForkBinding[] = [];

  recordFork(binding: SessionForkBinding): Promise<SessionForkBinding> {
    this.forks.push(binding);
    return Promise.resolve(binding);
  }

  listForks(): Promise<SessionForkBinding[]> {
    return Promise.resolve(this.forks);
  }
}

function createStoredSession(): StoredSession {
  return {
    id: "chat-source",
    userId: "user-1",
    name: "Build feature",
    projectId: "project-1",
    projectRoot: "/repo",
    sessionId: "agent-session-1",
    command: "codex",
    args: ["acp"],
    env: { HOME: "/tmp" },
    status: "stopped",
    pinned: true,
    archived: true,
    createdAt: 100,
    lastActiveAt: 200,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "hello",
        timestamp: 100,
      },
    ],
  };
}

describe("ForkSessionService", () => {
  test("duplicates stored session history and records a fork binding", async () => {
    const created: StoredSession[] = [];
    const bindings = new SessionBindingStub();
    const repo = {
      findById: () => Promise.resolve(createStoredSession()),
      create: (session: StoredSession) => {
        created.push(session);
        return Promise.resolve();
      },
    } as unknown as SessionRepositoryPort;
    const ids = ["chat-fork", "binding-1"];
    const service = new ForkSessionService({
      sessionRepo: repo,
      bindings,
      nowMs: () => 1000,
      idFactory: () => ids.shift() ?? "extra-id",
    });

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-source",
    });

    expect(result.chatId).toBe("chat-fork");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      id: "chat-fork",
      name: "Build feature (fork)",
      sessionId: undefined,
      status: "stopped",
      pinned: false,
      archived: false,
      createdAt: 1000,
      lastActiveAt: 1000,
      messageCount: 1,
    });
    expect(created[0]?.messages).toEqual(createStoredSession().messages);
    expect(bindings.forks[0]).toMatchObject({
      id: "binding-1",
      sourceChatId: "chat-source",
      forkedChatId: "chat-fork",
      messageCount: 1,
    });
  });
});
