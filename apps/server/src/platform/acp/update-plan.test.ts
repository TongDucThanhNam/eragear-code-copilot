import { describe, expect, test } from "bun:test";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { ChatSession, Plan } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { handlePlanUpdate } from "./update-plan";

function createSession(chatId: string): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;
}

function createRuntimeStub(session: ChatSession) {
  const broadcasts: unknown[] = [];
  const runtime = {
    get: (chatId: string) => (chatId === session.id ? session : undefined),
    broadcast: (_chatId: string, event: unknown) => {
      broadcasts.push(event);
      return Promise.resolve();
    },
    runExclusive: async <T>(
      _chatId: string,
      work: () => Promise<T>
    ): Promise<T> => await work(),
  } as unknown as SessionRuntimePort;
  return { runtime, broadcasts };
}

function createRepoStub() {
  const metadataCalls: Array<{
    chatId: string;
    userId: string;
    updates: Partial<ChatSession>;
  }> = [];
  const repo = {
    updateMetadata: (
      chatId: string,
      userId: string,
      updates: Partial<ChatSession>
    ) => {
      metadataCalls.push({ chatId, userId, updates });
      return Promise.resolve();
    },
  } as unknown as SessionRepositoryPort;
  return { repo, metadataCalls };
}

function createPlan(
  content: string,
  status: "pending" | "in_progress" | "completed"
): Plan {
  return {
    entries: [{ content, priority: "medium", status }],
  };
}

describe("handlePlanUpdate", () => {
  test("broadcasts when only content text changes", async () => {
    const session = createSession("chat-plan-content");
    session.plan = createPlan("old content", "pending");
    const { runtime, broadcasts } = createRuntimeStub(session);
    const { repo, metadataCalls } = createRepoStub();

    const handled = await handlePlanUpdate({
      chatId: session.id,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "new content", priority: "medium", status: "pending" },
        ],
      },
      sessionRuntime: runtime,
      sessionRepo: repo,
      finalizeStreamingForCurrentAssistant: async () => undefined,
    });

    expect(handled).toBe(true);
    expect(broadcasts.length).toBe(1);
    expect(metadataCalls.length).toBe(1);
  });

  test("broadcasts when status changes", async () => {
    const session = createSession("chat-plan-status");
    session.plan = createPlan("same content", "pending");
    const { runtime, broadcasts } = createRuntimeStub(session);
    const { repo } = createRepoStub();

    await handlePlanUpdate({
      chatId: session.id,
      update: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "same content",
            priority: "medium",
            status: "in_progress",
          },
        ],
      },
      sessionRuntime: runtime,
      sessionRepo: repo,
      finalizeStreamingForCurrentAssistant: async () => undefined,
    });

    expect(broadcasts.length).toBe(1);
  });

  test("suppresses broadcast for deeply identical plan payload", async () => {
    const session = createSession("chat-plan-identical");
    session.plan = createPlan("same content", "pending");
    const { runtime, broadcasts } = createRuntimeStub(session);
    const { repo } = createRepoStub();

    await handlePlanUpdate({
      chatId: session.id,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "same content", priority: "medium", status: "pending" },
        ],
      },
      sessionRuntime: runtime,
      sessionRepo: repo,
      finalizeStreamingForCurrentAssistant: async () => undefined,
    });

    expect(broadcasts.length).toBe(0);
  });
});
