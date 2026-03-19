import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ENV } from "@/config/environment";
import type {
  SessionListPageQuery,
  SessionListPageResult,
  SessionListQuery,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { SubscribeSessionEventsService } from "@/modules/session/application/subscribe-session-events.service";
import { SessionBuffering } from "@/platform/acp/update";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  BroadcastEvent,
  ChatSession,
  ChatStatus,
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { AiSessionRuntimeAdapter } from "../infra/ai-session-runtime.adapter";
import { PromptTaskRunner } from "./send-message/prompt-task-runner";
import {
  type SendMessagePolicy,
  SendMessageService,
} from "./send-message.service";

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
  onAppendMessage:
    | ((args: {
        chatId: string;
        userId: string;
        message: StoredMessage;
      }) => Promise<void>)
    | undefined;

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

  findPage(
    _userId: string,
    _query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return Promise.resolve({
      sessions: [],
      hasMore: false,
    });
  }

  findPageForMaintenance(
    _query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return Promise.resolve({
      sessions: [],
      hasMore: false,
    });
  }

  countAll(_userId: string): Promise<number> {
    return Promise.resolve(0);
  }

  create(_session: StoredSession): Promise<void> {
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
  ): Promise<{ appended: true }> {
    this.appendedMessages.push({ chatId: id, userId, message });
    if (this.onAppendMessage) {
      return this.onAppendMessage({ chatId: id, userId, message }).then(() => ({
        appended: true as const,
      }));
    }
    return Promise.resolve({ appended: true as const });
  }

  replaceMessages(
    _id: string,
    _userId: string,
    _messages: StoredMessage[]
  ): Promise<{ replaced: true }> {
    return Promise.resolve({ replaced: true as const });
  }

  getMessageById(
    _id: string,
    _userId: string,
    _messageId: string
  ): Promise<StoredMessage | undefined> {
    return Promise.resolve(undefined);
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
  const lockTails = new Map<string, Promise<void>>();
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
    deleteIfMatch(id, expectedSession) {
      const current = sessions.get(id);
      if (!current || current !== expectedSession) {
        return false;
      }
      sessions.delete(id);
      return true;
    },
    has(id) {
      return sessions.has(id);
    },
    getAll() {
      return [...sessions.values()];
    },
    async runExclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
      const previousTail = lockTails.get(id) ?? Promise.resolve();
      let releaseLock: () => void = () => undefined;
      const lockSignal = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const nextTail = previousTail.then(
        () => lockSignal,
        () => lockSignal
      );
      lockTails.set(id, nextTail);
      await previousTail.catch(() => undefined);
      try {
        return await work();
      } finally {
        releaseLock();
        if (lockTails.get(id) === nextTail) {
          lockTails.delete(id);
        }
      }
    },
    isLockHeld(id) {
      return lockTails.has(id);
    },
    broadcast(id, event) {
      if (!sessions.has(id)) {
        return Promise.resolve();
      }
      events.push(event as BroadcastEvent);
      return Promise.resolve();
    },
  };
}

function createPolicy(
  overrides?: Partial<SendMessagePolicy>
): SendMessagePolicy {
  return {
    messageContentMaxBytes: 1024 * 1024,
    messagePartsMaxBytes: 1024 * 1024,
    acpRetryMaxAttempts: 3,
    acpRetryBaseDelayMs: 1,
    ...overrides,
  };
}

function createService(
  repo: SessionRepositoryPort,
  runtime: SessionRuntimePort,
  policyOverrides?: Partial<SendMessagePolicy>
): SendMessageService {
  const clock: ClockPort = {
    nowMs: () => Date.now(),
  };
  const logger = createLoggerStub();
  const policy = createPolicy(policyOverrides);
  const sessionGateway = new AiSessionRuntimeAdapter(runtime, repo);
  const promptTaskRunner = new PromptTaskRunner({
    sessionRepo: repo,
    sessionRuntime: runtime,
    sessionGateway,
    logger,
    clock,
    policy: {
      acpRetryMaxAttempts: policy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: policy.acpRetryBaseDelayMs,
    },
    runtimePolicyProvider: () => ({
      maxTokens: 8192,
    }),
  });
  return new SendMessageService({
    sessionRepo: repo,
    sessionRuntime: runtime,
    sessionGateway,
    promptTaskRunner,
    logger,
    inputPolicy: policy,
    clock,
  });
}

function createChatSession(params: {
  prompt: (input: unknown) => Promise<{
    stopReason: string;
  }>;
  cancel?: (input: unknown) => Promise<void>;
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
    cancel: params.cancel ?? (async () => undefined),
  } as unknown as ChatSession["conn"];
  const emitter = new EventEmitter();
  emitter.on("data", () => undefined);

  return {
    id: "chat-1",
    userId: "user-1",
    proc,
    conn,
    projectRoot: "/tmp/project",
    sessionId: "acp-session-1",
    emitter,
    cwd: "/tmp/project",
    subscriberCount: 1,
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
  test("returns submitted and correlates status/finish events with turnId", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

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

    const userMessageEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message" }> =>
        event.type === "ui_message" && event.message.id === result.userMessageId
    );
    expect(userMessageEvent).toBeDefined();
    expect(userMessageEvent?.turnId).toBe(result.turnId);

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

  test("materializes buffered assistant output when streaming ui state is missing", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    let session!: ChatSession;
    session = createChatSession({
      prompt: () => {
        session.buffer ??= new SessionBuffering();
        session.buffer.ensureMessageId("msg-buffer-only");
        session.buffer.appendContent({
          type: "text",
          text: "buffer only answer",
        });
        return { stopReason: "end_turn" };
      },
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });

    await flushAsync();
    await flushAsync();

    const assistantMessageEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message" }> =>
        event.type === "ui_message" &&
        event.message.role === "assistant" &&
        event.message.id === "msg-buffer-only"
    );
    expect(assistantMessageEvent).toBeDefined();
    if (assistantMessageEvent?.type === "ui_message") {
      expect(assistantMessageEvent.turnId).toBe(result.turnId);
      expect(assistantMessageEvent.message.parts).toEqual([
        {
          type: "text",
          text: "buffer only answer",
          state: "done",
        },
      ]);
    }

    const finishEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "chat_finish" }> =>
        event.type === "chat_finish" && event.turnId === result.turnId
    );
    expect(finishEvent).toBeDefined();
    if (finishEvent?.type === "chat_finish") {
      expect(finishEvent.messageId).toBe("msg-buffer-only");
      expect(finishEvent.message?.id).toBe("msg-buffer-only");
    }

    expect(session.uiState.messages.get("msg-buffer-only")).toEqual({
      id: "msg-buffer-only",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "buffer only answer",
          state: "done",
        },
      ],
      createdAt: expect.any(Number),
    });
  });

  test("clears stale replay flags before starting a live prompt turn", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    session.isReplayingHistory = true;
    session.suppressReplayBroadcast = true;
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "live turn",
    });

    expect(session.isReplayingHistory).toBe(false);
    expect(session.suppressReplayBroadcast).toBe(false);
  });

  test("returns to ready after completion from any busy status", async () => {
    const busyStatuses: ChatStatus[] = [
      "streaming",
      "awaiting_permission",
      "cancelling",
    ];

    for (const busyStatus of busyStatuses) {
      const repo = new InMemorySessionRepo();
      const events: BroadcastEvent[] = [];
      let session!: ChatSession;
      session = createChatSession({
        prompt: () => {
          session.chatStatus = busyStatus;
          return Promise.resolve({ stopReason: "end_turn" });
        },
      });
      const runtime = createSessionRuntime("chat-1", session, events);
      const service = createService(repo, runtime);

      const result = await service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: `turn from ${busyStatus}`,
      });
      await flushAsync();

      const readyEvent = events.find(
        (event): event is Extract<BroadcastEvent, { type: "chat_status" }> =>
          event.type === "chat_status" &&
          event.status === "ready" &&
          event.turnId === result.turnId
      );
      expect(readyEvent).toBeDefined();
      expect(session.chatStatus).toBe("ready");
    }
  });

  test("rejects send when a prompt turn is already active", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const first = createDeferred<{ stopReason: string }>();
    let cancelCallCount = 0;
    const session = createChatSession({
      prompt: () => {
        return first.promise;
      },
      cancel: () => {
        cancelCallCount += 1;
        return Promise.resolve();
      },
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const turn1 = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "first",
    });
    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "second",
      })
    ).rejects.toMatchObject({
      code: "PROMPT_BUSY",
      statusCode: 409,
    });

    expect(cancelCallCount).toBe(0);
    expect(session.activeTurnId).toBe(turn1.turnId);

    first.resolve({ stopReason: "end_turn" });
    await flushAsync();
  });

  test("rejects send when realtime subscriber is not connected", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    session.emitter.removeAllListeners("data");
    session.subscriberCount = 0;
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
      })
    ).rejects.toMatchObject({
      code: "SESSION_SUBSCRIPTION_REQUIRED",
      statusCode: 409,
    });

    expect(events).toHaveLength(0);
    expect(repo.appendedMessages).toHaveLength(0);
    expect(session.activeTurnId).toBeUndefined();
  });

  test("serializes same-chat concurrent submits and rejects busy queued submit", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const firstPrompt = createDeferred<{ stopReason: string }>();
    const firstAppendBlocked = createDeferred<void>();
    const releaseFirstAppend = createDeferred<void>();
    let promptCallCount = 0;
    repo.onAppendMessage = async () => {
      if (repo.appendedMessages.length === 1) {
        firstAppendBlocked.resolve();
        await releaseFirstAppend.promise;
      }
    };
    const session = createChatSession({
      prompt: () => {
        promptCallCount += 1;
        if (promptCallCount === 1) {
          return firstPrompt.promise;
        }
        return Promise.resolve({ stopReason: "end_turn" });
      },
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const firstSubmit = service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "first",
    });
    await firstAppendBlocked.promise;

    const secondSubmit = service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "second",
    });
    await flushAsync();
    expect(promptCallCount).toBe(0);

    releaseFirstAppend.resolve();
    const turn1 = await firstSubmit;
    await expect(secondSubmit).rejects.toMatchObject({
      code: "PROMPT_BUSY",
      statusCode: 409,
    });
    expect(promptCallCount).toBe(1);
    expect(session.activeTurnId).toBe(turn1.turnId);

    firstPrompt.resolve({ stopReason: "end_turn" });
    await flushAsync();
  });

  test("uses canonical msg IDs from createId utility", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const first = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "first",
    });
    await flushAsync();
    await flushAsync();
    const second = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "second",
    });

    expect(first.userMessageId).toStartWith("msg-");
    expect(second.userMessageId).toStartWith("msg-");
    expect(first.userMessageId).not.toBe(second.userMessageId);
  });

  test("resets stale assistant stream pointers at new turn start", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const staleAssistantId = "msg-assistant-stale";
    let session!: ChatSession;
    let assistantIdAtPrompt: string | undefined;
    let lastChunkTypeAtPrompt:
      | ChatSession["lastAssistantChunkType"]
      | undefined;
    let bufferedMessageIdAtPrompt: string | null | undefined;

    session = createChatSession({
      prompt: () => {
        assistantIdAtPrompt = session.uiState.currentAssistantId;
        lastChunkTypeAtPrompt = session.lastAssistantChunkType;
        bufferedMessageIdAtPrompt = session.buffer?.getMessageId();
        return { stopReason: "end_turn" };
      },
    });
    session.uiState.messages.set(staleAssistantId, {
      id: staleAssistantId,
      role: "assistant",
      createdAt: Date.now() - 1,
      parts: [{ type: "text", text: "stale assistant message" }],
    });
    session.uiState.currentAssistantId = staleAssistantId;
    session.lastAssistantChunkType = "message";
    session.buffer = new SessionBuffering();
    session.buffer.ensureMessageId(staleAssistantId);
    session.buffer.appendContent({
      type: "text",
      text: "stale buffered chunk",
    });

    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "new prompt",
    });

    expect(assistantIdAtPrompt).toBeUndefined();
    expect(lastChunkTypeAtPrompt).toBeUndefined();
    expect(bufferedMessageIdAtPrompt).toBeNull();
  });

  test("clears active turn and returns to ready when user-message persistence fails", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    let promptCalls = 0;
    repo.onAppendMessage = () =>
      Promise.reject(new Error("sqlite unavailable"));
    const session = createChatSession({
      prompt: () => {
        promptCalls += 1;
        return Promise.resolve({ stopReason: "end_turn" });
      },
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
      })
    ).rejects.toThrow("sqlite unavailable");

    expect(promptCalls).toBe(0);
    expect(session.activeTurnId).toBeUndefined();
    expect(session.activePromptTask).toBeUndefined();
    expect(
      events.some(
        (event) =>
          event.type === "error" && event.error === "sqlite unavailable"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === "chat_status" && event.status === "ready"
      )
    ).toBe(true);
  });

  test("rejects oversized inline media payloads by decoded bytes", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime, {
      messagePartsMaxBytes: 10,
    });

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
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime, {
      messagePartsMaxBytes: 1024,
    });

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
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime, {
      messagePartsMaxBytes: 1024,
    });

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

  test("returns chat to ready when prompt request fails but session remains alive", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: () => Promise.reject(new Error("unexpected prompt crash")),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });
    await flushAsync();

    const readyEvent = events.find(
      (event) =>
        event.type === "chat_status" &&
        event.status === "ready" &&
        event.turnId === result.turnId
    );
    expect(readyEvent).toBeDefined();
    expect(
      events.some(
        (event) =>
          event.type === "error" &&
          event.error.includes("unexpected prompt crash")
      )
    ).toBe(true);
    expect(repo.appendedMessages).toHaveLength(2);
    expect(repo.appendedMessages[1]?.message.role).toBe("assistant");
    expect(repo.appendedMessages[1]?.message.content).toContain(
      "unexpected prompt crash"
    );
    expect(session.activeTurnId).toBeUndefined();
    expect(session.activePromptTask).toBeUndefined();
  });

  test("aborts orphaned prompt after subscriber grace period elapses", async () => {
    const originalGraceMs = ENV.promptNoSubscriberAbortGraceMs;
    ENV.promptNoSubscriberAbortGraceMs = 5;
    try {
      const repo = new InMemorySessionRepo();
      const events: BroadcastEvent[] = [];
      const promptStarted = createDeferred<void>();
      let cancelCallCount = 0;
      const session = createChatSession({
        prompt: async () => {
          promptStarted.resolve();
          return await new Promise<{ stopReason: string }>(() => undefined);
        },
        cancel: () => {
          cancelCallCount += 1;
        },
      });
      session.emitter.removeAllListeners("data");
      session.subscriberCount = 0;
      const runtime = createSessionRuntime("chat-1", session, events);
      const subscriptionService = new SubscribeSessionEventsService(
        runtime,
        repo
      );
      const live = await subscriptionService.execute("user-1", "chat-1");
      const unsubscribe = live.subscribe(async () => undefined);
      const service = createService(repo, runtime);

      const submitted = await service.execute({
        userId: "user-1",
        chatId: "chat-1",
        text: "hello",
      });
      await promptStarted.promise;

      unsubscribe();
      await live.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await flushAsync();

      expect(cancelCallCount).toBe(1);
      expect(session.activePromptTask).toBeUndefined();
      expect(session.activeTurnId).toBeUndefined();
      expect(
        events.some(
          (event) =>
            event.type === "chat_finish" &&
            event.turnId === submitted.turnId &&
            event.stopReason === "cancelled"
        )
      ).toBe(true);
    } finally {
      ENV.promptNoSubscriberAbortGraceMs = originalGraceMs;
    }
  });

  test("marks chat error without synthetic chat_finish when agent process exits mid-turn", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: () => Promise.reject(new Error("process exited unexpectedly")),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

    const result = await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      text: "hello",
    });
    await flushAsync();
    await flushAsync();

    expect(
      events.some(
        (event) =>
          event.type === "chat_finish" && event.turnId === result.turnId
      )
    ).toBe(false);

    const errorStatusEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "chat_status" }> =>
        event.type === "chat_status" &&
        event.status === "error" &&
        event.turnId === result.turnId
    );
    expect(errorStatusEvent).toBeDefined();
    expect(session.activeTurnId).toBeUndefined();
  });

  test("rejects message send for session owned by another user", async () => {
    const repo = new InMemorySessionRepo();
    const events: BroadcastEvent[] = [];
    const session = createChatSession({
      prompt: async () => ({ stopReason: "end_turn" }),
    });
    const runtime = createSessionRuntime("chat-1", session, events);
    const service = createService(repo, runtime);

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
