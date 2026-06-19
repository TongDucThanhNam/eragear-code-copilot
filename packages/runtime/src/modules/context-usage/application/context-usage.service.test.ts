import { describe, expect, test } from "bun:test";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
  StoredMessage,
  StoredSession,
} from "#runtime/modules/session";
import { NotFoundError } from "#runtime/shared/errors";
import type { ChatSession } from "#runtime/shared/types/session.types";
import { ContextUsageService } from "./context-usage.service";
import type { ContextUsageEstimateInput } from "./contracts/context-usage.contract";
import type {
  ContextUsageEstimatorPort,
  ContextUsageTokenEstimateInput,
  ContextUsageWindowInput,
} from "./ports/context-usage-estimator.port";

class ContextUsageEstimatorStub implements ContextUsageEstimatorPort {
  estimateTokens(input: ContextUsageTokenEstimateInput) {
    const historyTokens = input.messages.length * 10;
    const draftTokens = input.draftText.length;
    const attachmentTokens = input.attachmentCount * 5;
    const mentionTokens = input.mentionCount * 3;
    return {
      totalTokens:
        historyTokens + draftTokens + attachmentTokens + mentionTokens,
      source: "local-estimate" as const,
      breakdown: {
        historyTokens,
        draftTokens,
        attachmentTokens,
        mentionTokens,
      },
    };
  }

  resolveContextWindow(_input: ContextUsageWindowInput) {
    return {
      maxTokens: 100,
      source: "fallback" as const,
    };
  }
}

class SessionRepositoryStub implements Partial<SessionRepositoryPort> {
  session?: StoredSession;
  messages: StoredMessage[] = [];
  hasMore = false;

  findById(_id: string, _userId: string) {
    return Promise.resolve(this.session);
  }

  getMessagesPage() {
    return Promise.resolve({
      messages: this.messages,
      hasMore: this.hasMore,
    });
  }
}

class SessionRuntimeStub implements Partial<SessionRuntimePort> {
  session?: ChatSession;

  get(_chatId: string) {
    return this.session;
  }
}

function makeStoredSession(
  overrides: Partial<StoredSession> = {}
): StoredSession {
  return {
    id: "chat-1",
    userId: "user-1",
    projectRoot: "/repo",
    status: "running",
    createdAt: 1,
    lastActiveAt: 1,
    messages: [],
    ...overrides,
  };
}

function makeMessage(input: {
  id: string;
  role: "user" | "assistant";
  content: string;
}): StoredMessage {
  return {
    ...input,
    timestamp: 1,
  };
}

function makeService(
  params: {
    repo?: SessionRepositoryStub;
    runtime?: SessionRuntimeStub;
    estimator?: ContextUsageEstimatorPort;
  } = {}
) {
  const repo = params.repo ?? new SessionRepositoryStub();
  const runtime = params.runtime ?? new SessionRuntimeStub();
  const service = new ContextUsageService({
    sessionRepo: repo as unknown as SessionRepositoryPort,
    sessionRuntime: runtime as unknown as SessionRuntimePort,
    estimator: params.estimator ?? new ContextUsageEstimatorStub(),
    nowMs: () => 123,
  });
  return { repo, runtime, service };
}

describe("ContextUsageService", () => {
  test("estimates per-session history, draft, attachment, and mention usage", async () => {
    const { repo, service } = makeService();
    repo.session = makeStoredSession({ modelId: "gpt-4o" });
    repo.messages = [
      makeMessage({ id: "m1", role: "user", content: "hello" }),
      makeMessage({ id: "m2", role: "assistant", content: "hi" }),
    ];
    repo.hasMore = true;

    const input: ContextUsageEstimateInput = {
      chatId: "chat-1",
      draftText: "draft",
      attachmentCount: 2,
      attachmentBytes: 500,
      mentionCount: 1,
    };
    const result = await service.estimate("user-1", input);

    expect(result).toMatchObject({
      chatId: "chat-1",
      modelId: "gpt-4o",
      usedTokens: 38,
      maxTokens: 100,
      remainingTokens: 62,
      percentUsed: 38,
      status: "ok",
      messageCount: 2,
      truncatedHistory: true,
      estimatedAt: 123,
      tokenSource: "local-estimate",
      breakdown: {
        historyTokens: 20,
        draftTokens: 5,
        attachmentTokens: 10,
        mentionTokens: 3,
      },
    });
  });

  test("uses runtime model provider when a live session is available", async () => {
    const { repo, runtime, service } = makeService();
    repo.session = makeStoredSession();
    runtime.session = {
      id: "chat-1",
      userId: "user-1",
      projectRoot: "/repo",
      models: {
        currentModelId: "claude-3-5-sonnet-20240620",
        availableModels: [
          {
            modelId: "claude-3-5-sonnet-20240620",
            name: "Claude Sonnet",
            provider: "anthropic",
          },
        ],
      },
    } as ChatSession;

    const result = await service.estimate("user-1", {
      chatId: "chat-1",
      draftText: "",
      attachmentCount: 0,
      attachmentBytes: 0,
      mentionCount: 0,
    });

    expect(result.modelId).toBe("claude-3-5-sonnet-20240620");
    expect(result.modelProvider).toBe("anthropic");
  });

  test("rejects sessions that do not belong to the user", async () => {
    const { runtime, service } = makeService();
    runtime.session = {
      id: "chat-1",
      userId: "other-user",
      projectRoot: "/repo",
    } as ChatSession;

    await expect(
      service.estimate("user-1", {
        chatId: "chat-1",
        draftText: "",
        attachmentCount: 0,
        attachmentBytes: 0,
        mentionCount: 0,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
