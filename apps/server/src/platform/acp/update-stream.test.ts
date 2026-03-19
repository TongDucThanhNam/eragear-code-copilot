import { describe, expect, test } from "bun:test";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { SessionBroadcastOptions } from "@/modules/session/application/ports/session-runtime.port";
import type {
  BroadcastEvent,
  ChatSession,
  StoredContentBlock,
} from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SessionBuffering } from "./update-buffer";
import { handleBufferedMessage } from "./update-stream";
import { resolveSessionUpdateTurnId } from "./update-turn-id";
import type { SessionUpdate } from "./update-types";

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

function createRuntimeStub(session: ChatSession): {
  runtime: SessionRuntimePort;
  calls: Array<{
    event: BroadcastEvent;
    options?: SessionBroadcastOptions;
  }>;
} {
  const calls: Array<{
    event: BroadcastEvent;
    options?: SessionBroadcastOptions;
  }> = [];
  const runtime = {
    get: (chatId: string) => (chatId === session.id ? session : undefined),
    broadcast: (
      _chatId: string,
      event: BroadcastEvent,
      options?: SessionBroadcastOptions
    ) => {
      calls.push({ event, options });
      return Promise.resolve();
    },
    runExclusive: async <T>(
      _chatId: string,
      work: () => Promise<T>
    ): Promise<T> => await work(),
  } as unknown as SessionRuntimePort;
  return { runtime, calls };
}

function createContext(params: {
  chatId: string;
  buffer: SessionBufferingPort;
  runtime: SessionRuntimePort;
  update: SessionUpdate;
  isReplayingHistory?: boolean;
  suppressReplayBroadcast?: boolean;
  sessionRepo?: SessionRepositoryPort;
  finalizeStreamingForCurrentAssistant?: (
    chatId: string,
    runtime: SessionRuntimePort,
    buffer: SessionBufferingPort
  ) => Promise<void>;
}) {
  const isReplayingHistory = params.isReplayingHistory ?? false;
  const suppressReplayBroadcast = params.suppressReplayBroadcast ?? false;
  const sessionRepo =
    params.sessionRepo ??
    ({
      appendMessage: async () => ({ appended: true }),
    } as SessionRepositoryPort);
  return {
    chatId: params.chatId,
    buffer: params.buffer,
    isReplayingHistory,
    suppressReplayBroadcast,
    update: params.update,
    turnIdResolution: resolveSessionUpdateTurnId(params.update),
    sessionRuntime: params.runtime,
    sessionRepo,
    finalizeStreamingForCurrentAssistant:
      params.finalizeStreamingForCurrentAssistant ?? (async () => undefined),
  };
}

describe("handleBufferedMessage", () => {
  test("buffers text chunks without broadcasting partial snapshots", async () => {
    const session = createSession("chat-stream-text");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " world" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    expect(calls).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    expect(assistantId).toEqual(expect.any(String));
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Hello world");
      expect(textPart.state).toBe("streaming");
    }
  });

  test("coalesces long text streams in ui state until finalize", async () => {
    const session = createSession("chat-stream-linear");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    const chunk = "0123456789";

    for (let index = 0; index < 200; index += 1) {
      await handleBufferedMessage(
        createContext({
          chatId: session.id,
          buffer,
          runtime,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: chunk } as StoredContentBlock,
          } as SessionUpdate,
        })
      );
    }
    expect(calls).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe(chunk.repeat(200));
      expect(textPart.state).toBe("streaming");
    }
  });

  test("stores escaped html text in buffered part snapshots", async () => {
    const session = createSession("chat-stream-escape");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "safe" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "<tag>" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    expect(calls).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("safe&lt;tag&gt;");
    }
  });

  test("buffers reasoning chunks without broadcasting partial snapshots", async () => {
    const session = createSession("chat-reasoning-buffer");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "think-1" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: " think-2" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    expect(calls).toHaveLength(0);
    expect(buffer.hasPendingReasoning()).toBe(false);
    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const reasoningPart = message?.parts.find(
      (part) => part.type === "reasoning"
    );
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.text).toBe("think-1 think-2");
      expect(reasoningPart.state).toBe("streaming");
    }
  });

  test("invokes finalize callback when assistant chunk type transitions", async () => {
    const session = createSession("chat-transition");
    const { runtime } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    let finalizeCalls = 0;

    const finalize = () => {
      finalizeCalls += 1;
      return Promise.resolve();
    };

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        finalizeStreamingForCurrentAssistant: finalize,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "A" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        finalizeStreamingForCurrentAssistant: finalize,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "B" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(finalizeCalls).toBe(1);
  });

  test("keeps reasoning and text in separate assistant parts on chunk transition", async () => {
    const session = createSession("chat-reasoning-to-text");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "plan " } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    const partEvents = calls.filter(
      (call) => call.event.type === "ui_message_part"
    );
    expect(partEvents).toHaveLength(0);

    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    expect(message?.parts).toHaveLength(2);
    expect(message?.parts[0]?.type).toBe("reasoning");
    expect(message?.parts[1]?.type).toBe("text");
  });

  test("broadcasts non-text assistant chunks as part updates", async () => {
    const session = createSession("chat-stream-non-text");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "resource_link",
            uri: "https://example.com/resource",
            title: "resource",
          } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.event.type).toBe("ui_message_part");
  });

  test("applies replay chunks to ui state while suppressing replay broadcast", async () => {
    const session = createSession("chat-stream-replay-suppressed");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " world" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(calls).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Hello world");
      expect(textPart.state).toBe("done");
    }
  });

  test("starts a new assistant message when a new user chunk arrives", async () => {
    const session = createSession("chat-stream-user-boundary");
    const { runtime } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "question-1" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer-1" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "question-2" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: true,
        suppressReplayBroadcast: true,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer-2" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    const assistantMessages = [...session.uiState.messages.values()].filter(
      (message) => message.role === "assistant"
    );
    expect(assistantMessages).toHaveLength(2);
    const assistantTexts = assistantMessages.map((message) =>
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
    );
    expect(assistantTexts).toEqual(["answer-1", "answer-2"]);
  });

  test("accepts live user_message_chunk as a separate ACP-authored user message", async () => {
    const session = createSession("chat-stream-live-user-chunk");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    session.uiState.messages.set("client-user-1", {
      id: "client-user-1",
      role: "user",
      createdAt: 1,
      parts: [{ type: "text", text: "client-message", state: "done" }],
    });
    session.uiState.currentUserId = "client-user-1";
    session.uiState.currentUserSource = "client";

    const handled = await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        isReplayingHistory: false,
        update: {
          sessionUpdate: "user_message_chunk",
          content: {
            type: "text",
            text: "should-not-apply",
          } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.event.type).toBe("ui_message");
    expect(session.uiState.currentUserId).toEqual(expect.any(String));
    expect(session.uiState.currentUserId).not.toBe("client-user-1");
    expect(session.uiState.messages.size).toBe(2);
    const acpUserMessage = session.uiState.currentUserId
      ? session.uiState.messages.get(session.uiState.currentUserId)
      : undefined;
    const textPart = acpUserMessage?.parts[0];
    expect(acpUserMessage?.role).toBe("user");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("should-not-apply");
      expect(textPart.state).toBe("done");
    }
    expect(session.uiState.messages.get("client-user-1")?.parts[0]).toEqual({
      type: "text",
      text: "client-message",
      state: "done",
    });
  });

  test("drops untagged assistant chunks after a live ACP user boundary", async () => {
    const session = createSession("chat-stream-ghost-guard");
    session.activeTurnId = "turn-live";
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "question" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    const handledLateChunk = await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "late old answer",
          } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(handledLateChunk).toBe(true);
    expect(session.uiState.currentAssistantId).toBeUndefined();
    expect(
      [...session.uiState.messages.values()].filter(
        (message) => message.role === "assistant"
      )
    ).toHaveLength(0);

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          turnId: "turn-live",
          content: { type: "text", text: "fresh answer" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    const assistantId = session.uiState.currentAssistantId;
    expect(assistantId).toEqual(expect.any(String));
    const assistantMessage = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = assistantMessage?.parts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("fresh answer");
    }
    expect(
      calls.some(
        (call) =>
          call.event.type === "ui_message_part" &&
          call.event.part.type === "text" &&
          call.event.part.text === "late old answer"
      )
    ).toBe(false);
  });

  test("does not emit live text part events before finalize", async () => {
    const session = createSession("chat-stream-turn-id");
    session.activeTurnId = "turn-live";
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          turnId: "turn-live",
          content: { type: "text", text: "hello" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          turnId: "turn-live",
          content: { type: "text", text: " world" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    expect(calls).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    const message = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("hello world");
      expect(textPart.state).toBe("streaming");
    }
  });

  test("emits late text part updates for recently completed turn", async () => {
    const session = createSession("chat-stream-late-tail");
    session.activeTurnId = undefined;
    session.lastCompletedTurnId = "turn-tail";
    session.lastCompletedTurnAtMs = Date.now();
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    const appendCalls: Array<{
      chatId: string;
      userId: string;
      messageId: string;
      content: string;
    }> = [];
    const sessionRepo = {
      appendMessage: (
        chatId: string,
        userId: string,
        message: { id: string; content: string }
      ) => {
        appendCalls.push({
          chatId,
          userId,
          messageId: message.id,
          content: message.content,
        });
        return { appended: true } as const;
      },
    } as SessionRepositoryPort;

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        sessionRepo,
        update: {
          sessionUpdate: "agent_message_chunk",
          turnId: "turn-tail",
          content: { type: "text", text: "tail" } as StoredContentBlock,
        } as never,
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.part.type).toBe("text");
      expect(calls[0].event.turnId).toBe("turn-tail");
    }
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]).toMatchObject({
      chatId: session.id,
      userId: "user-1",
      content: "tail",
    });
    expect(appendCalls[0]?.messageId).toEqual(expect.any(String));
  });

  test("attaches late completed-turn chunk to last assistant message id", async () => {
    const session = createSession("chat-stream-late-tail-existing");
    session.activeTurnId = undefined;
    session.lastCompletedTurnId = "turn-tail-existing";
    session.lastCompletedTurnAtMs = Date.now();
    session.uiState.lastAssistantId = "msg-existing-assistant";
    session.uiState.messages.set("msg-existing-assistant", {
      id: "msg-existing-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "prefix-", state: "done" }],
      createdAt: 1,
    });

    const { runtime } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    const appendCalls: Array<{ messageId: string; content: string }> = [];
    const sessionRepo = {
      appendMessage: (
        _chatId: string,
        _userId: string,
        message: { id: string; content: string }
      ) => {
        appendCalls.push({ messageId: message.id, content: message.content });
        return { appended: true } as const;
      },
    } as SessionRepositoryPort;

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        sessionRepo,
        update: {
          sessionUpdate: "agent_message_chunk",
          turnId: "turn-tail-existing",
          content: { type: "text", text: "tail" } as StoredContentBlock,
        } as never,
      })
    );

    const message = session.uiState.messages.get("msg-existing-assistant");
    expect(message).toBeDefined();
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("prefix-tail");
      expect(textPart.state).toBe("streaming");
    }
    expect(session.uiState.currentAssistantId).toBe("msg-existing-assistant");
    expect(appendCalls).toEqual([
      {
        messageId: "msg-existing-assistant",
        content: "prefix-tail",
      },
    ]);
  });

  test("recovers missing turnId for late completed-turn chunk and emits tail", async () => {
    const session = createSession("chat-stream-late-tail-missing-turn-id");
    session.activeTurnId = undefined;
    session.lastCompletedTurnId = "turn-tail-missing-turn-id";
    session.lastCompletedTurnAtMs = Date.now();
    session.uiState.lastAssistantId = "msg-existing-assistant";
    session.uiState.messages.set("msg-existing-assistant", {
      id: "msg-existing-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "prefix-", state: "done" }],
      createdAt: 1,
    });

    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    const appendCalls: Array<{ messageId: string; content: string }> = [];
    const sessionRepo = {
      appendMessage: (
        _chatId: string,
        _userId: string,
        message: { id: string; content: string }
      ) => {
        appendCalls.push({ messageId: message.id, content: message.content });
        return { appended: true } as const;
      },
    } as SessionRepositoryPort;

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        sessionRepo,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "tail" } as StoredContentBlock,
        } as never,
      })
    );

    const message = session.uiState.messages.get("msg-existing-assistant");
    expect(message).toBeDefined();
    const textPart = message?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("prefix-tail");
      expect(textPart.state).toBe("streaming");
    }
    expect(session.uiState.currentAssistantId).toBe("msg-existing-assistant");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.turnId).toBe("turn-tail-missing-turn-id");
    }
    expect(appendCalls).toEqual([
      {
        messageId: "msg-existing-assistant",
        content: "prefix-tail",
      },
    ]);
  });
});
