import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ENV } from "@/config/environment";
import type {
  SessionListQuery,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  BroadcastEvent,
  ChatSession,
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SendMessageService } from "./send-message.service";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class InMemorySessionRepo implements SessionRepositoryPort {
  readonly appendedMessages: Array<{
    chatId: string;
    userId: string;
    message: StoredMessage;
  }> = [];
  readonly statusUpdates: Array<{
    id: string;
    userId: string;
    status: "running" | "stopped";
    touchLastActiveAt?: boolean;
  }> = [];

  findById(_id: string, _userId: string): Promise<StoredSession | undefined> {
    return Promise.resolve(undefined);
  }

  findAll(
    _userId: string,
    _query?: SessionListQuery
  ): Promise<StoredSession[]> {
    return Promise.resolve([]);
  }

  findAllForMaintenance(_query?: SessionListQuery): Promise<StoredSession[]> {
    return Promise.resolve([]);
  }

  countAll(_userId: string): Promise<number> {
    return Promise.resolve(0);
  }

  save(_session: StoredSession): Promise<void> {
    return Promise.resolve();
  }

  updateStatus(
    id: string,
    userId: string,
    status: "running" | "stopped",
    options?: { touchLastActiveAt?: boolean }
  ): Promise<void> {
    this.statusUpdates.push({
      id,
      userId,
      status,
      touchLastActiveAt: options?.touchLastActiveAt,
    });
    return Promise.resolve();
  }

  updateMetadata(
    _id: string,
    _userId: string,
    _updates: Partial<StoredSession>
  ): Promise<void> {
    return Promise.resolve();
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  appendMessage(
    id: string,
    userId: string,
    message: StoredMessage
  ): Promise<void> {
    this.appendedMessages.push({ chatId: id, userId, message });
    return Promise.resolve();
  }

  getMessagesPage(
    _id: string,
    _userId: string,
    _query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    return Promise.resolve({
      messages: [],
      hasMore: false,
      nextCursor: undefined,
    });
  }

  compactMessages(_input: {
    beforeTimestamp: number;
    batchSize: number;
    sessionIds: string[];
  }): Promise<{ compacted: number }> {
    return Promise.resolve({ compacted: 0 });
  }

  getStorageStats(): Promise<SessionStorageStats> {
    return Promise.resolve({
      dbSizeBytes: 0,
      walSizeBytes: 0,
      freePages: 0,
      sessionCount: 0,
      messageCount: 0,
      writeQueueDepth: 0,
    });
  }
}

function createLoggerStub(): LoggerPort {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function createSessionRuntime(
  chatId: string,
  session: ChatSession,
  events: BroadcastEvent[]
): SessionRuntimePort {
  const sessions = new Map<string, ChatSession>([[chatId, session]]);
  return {
    set(id, nextSession) {
      sessions.set(id, nextSession);
    },
    get(id) {
      return sessions.get(id);
    },
    delete(id) {
      sessions.delete(id);
    },
    has(id) {
      return sessions.has(id);
    },
    getAll() {
      return [...sessions.values()];
    },
    broadcast(id, event) {
      if (!sessions.has(id)) {
        return;
      }
      events.push(event as BroadcastEvent);
    },
  };
}

function createChatSession(params: {
  prompt: (input: unknown) => Promise<{
    stopReason: string;
  }>;
}): ChatSession {
  const proc = {
    pid: 123,
    stdin: {
      destroyed: false,
      writable: true,
    },
    killed: false,
    exitCode: null,
    kill() {
      return true;
    },
  } as unknown as ChatSession["proc"];

  const conn = {
    signal: { aborted: false },
    prompt: params.prompt,
  } as unknown as ChatSession["conn"];

  return {
    id: "chat-1",
    userId: "user-1",
    proc,
    conn,
    projectRoot: "/tmp/project",
    sessionId: "acp-session-1",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
    promptCapabilities: {
      image: true,
      audio: true,
      embeddedContext: true,
    },
  };
}

describe("SendMessageService", () => {
  const originalPartsLimit = ENV.messagePartsMaxBytes;

  afterEach(() => {
    ENV.messagePartsMaxBytes = originalPartsLimit;
  });

  test("returns submitted and correlates status/finish events with turnId", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });

    expect(result.status).toBe("submitted");
    expect(result.turnId).toStartWith("turn-");
    expect(repo.appendedMessages).toHaveLength(1);
    expect(repo.appendedMessages[0]?.message.id).toBe(result.userMessageId);

    await flushAsync();

    const submittedEvent = events.find(
      (event) => event.type === "chat_status" && event.status === "submitted"
    );
    expect(submittedEvent).toBeDefined();
    if (submittedEvent?.type === "chat_status") {
      expect(submittedEvent.turnId).toBe(result.turnId);
    }

    const finishEvent = events.find((event) => event.type === "chat_finish");
    expect(finishEvent).toBeDefined();
    if (finishEvent?.type === "chat_finish") {
      expect(finishEvent.turnId).toBe(result.turnId);
      expect(finishEvent.stopReason).toBe("end_turn");
    }

    const readyEvent = events.find(
      (event) => event.type === "chat_status" && event.status === "ready"
    );
    expect(readyEvent).toBeDefined();
    if (readyEvent?.type === "chat_status") {
      expect(readyEvent.turnId).toBe(result.turnId);
    }
    expect(session.activeTurnId).toBeUndefined();
  });

  test("ignores stale turn completion after a newer turn starts", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const first = createDeferred<{ stopReason: string }>();
    const second = createDeferred<{ stopReason: string }>();
    let promptCallCount = 0;
    const session = createChatSession({
      prompt: () => {
        promptCallCount += 1;
        if (promptCallCount === 1) {
          return first.promise;
        }
        return second.promise;
      },
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    const turn1 = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "first",
    });
    const turn2 = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "second",
    });

    expect(turn1.turnId).not.toBe(turn2.turnId);
    expect(session.activeTurnId).toBe(turn2.turnId);

    first.resolve({ stopReason: "end_turn" });
    await flushAsync();
    const staleFinishEvent = events
      .filter(
        (event): event is Extract<BroadcastEvent, { type: "chat_finish" }> =>
          event.type === "chat_finish"
      )
      .find((event) => event.turnId === turn1.turnId);
    expect(staleFinishEvent).toBeUndefined();

    second.resolve({ stopReason: "end_turn" });
    await flushAsync();
    const activeFinishEvent = events
      .filter(
        (event): event is Extract<BroadcastEvent, { type: "chat_finish" }> =>
          event.type === "chat_finish"
      )
      .find((event) => event.turnId === turn2.turnId);
    expect(activeFinishEvent).toBeDefined();
    expect(session.activeTurnId).toBeUndefined();
  });

  test("rejects oversized inline media payloads by decoded bytes", async () => {
    ENV.messagePartsMaxBytes = 10;
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
        images: [
          {
            // 16 base64 chars => 12 decoded bytes.
            base64: "AAAAAAAAAAAAAAAA",
            mimeType: "image/png",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  test("accepts whitespace-normalized valid base64 payloads", async () => {
    ENV.messagePartsMaxBytes = 1024;
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
        images: [
          {
            base64: " SGVs bG8=\n",
            mimeType: "image/png",
          },
        ],
      })
    ).resolves.toMatchObject({
      status: "submitted",
    });
  });

  test("rejects malformed base64 payloads", async () => {
    ENV.messagePartsMaxBytes = 1024;
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
        images: [
          {
            base64: "###=",
            mimeType: "image/png",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
    });

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
        images: [
          {
            base64: "SGVsbG8===",
            mimeType: "image/png",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  test("marks chat error when prompt task throws unexpectedly", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: () => Promise.reject(new Error("unexpected prompt crash")),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });
    await flushAsync();

    const errorStatusEvent = events.find(
      (event) =>
        event.type === "chat_status" &&
        event.status === "error" &&
        event.turnId === result.turnId
    );
    expect(errorStatusEvent).toBeDefined();
    expect(session.activeTurnId).toBeUndefined();
    expect(session.activePromptTask).toBeUndefined();
  });

  test("rejects message send for session owned by another user", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = new SendMessageService(repo, runtime, createLoggerStub());

    await expect(
      service.execute({
        userId: "user-2",
        chatId: "chat-1",
        text: "hello",
      })
    ).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });
});
