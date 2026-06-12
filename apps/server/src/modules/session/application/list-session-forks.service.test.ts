import { describe, expect, test } from "bun:test";
import { ListSessionForksService } from "./list-session-forks.service";
import type {
  SessionBindingPort,
  SessionForkBinding,
} from "./ports/session-binding.port";

class SessionBindingStub implements SessionBindingPort {
  forks: SessionForkBinding[] = [
    {
      id: "binding-1",
      userId: "user-1",
      sourceChatId: "chat-a",
      forkedChatId: "chat-b",
      projectRoot: "/repo",
      createdAt: 100,
      messageCount: 3,
    },
  ];

  recordFork(binding: SessionForkBinding): Promise<SessionForkBinding> {
    this.forks.unshift(binding);
    return Promise.resolve(binding);
  }

  listForks(userId: string, chatId: string): Promise<SessionForkBinding[]> {
    return Promise.resolve(
      this.forks.filter(
        (binding) =>
          binding.userId === userId &&
          (binding.sourceChatId === chatId || binding.forkedChatId === chatId)
      )
    );
  }
}

describe("ListSessionForksService", () => {
  test("returns fork bindings for either side of the fork relation", async () => {
    const service = new ListSessionForksService(new SessionBindingStub());

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-b",
    });

    expect(result.count).toBe(1);
    expect(result.bindings[0]).toMatchObject({
      sourceChatId: "chat-a",
      forkedChatId: "chat-b",
    });
  });
});
