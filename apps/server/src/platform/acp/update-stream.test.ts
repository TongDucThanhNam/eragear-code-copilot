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
  finalizeStreamingForCurrentAssistant?: (
    chatId: string,
    runtime: SessionRuntimePort,
    buffer: SessionBufferingPort
  ) => Promise<void>;
}) {
  const isReplayingHistory = params.isReplayingHistory ?? false;
  const suppressReplayBroadcast = params.suppressReplayBroadcast ?? false;
  return {
    chatId: params.chatId,
    buffer: params.buffer,
    isReplayingHistory,
    suppressReplayBroadcast,
    update: params.update,
    sessionRuntime: params.runtime,
    sessionRepo: {} as SessionRepositoryPort,
    finalizeStreamingForCurrentAssistant:
      params.finalizeStreamingForCurrentAssistant ?? (async () => undefined),
  };
}

describe("handleBufferedMessage", () => {
  test("broadcasts assistant text as part event first, then deltas", async () => {
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

    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    // Second call is the delta for " world" — no full ui_message snapshot
    const partEvent = calls[0]?.event;
    const messageId =
      partEvent?.type === "ui_message_part" ? partEvent.messageId : "";
    expect(calls[1]).toEqual({
      event: {
        type: "ui_message_delta",
        messageId,
        partIndex: 0,
        delta: " world",
      },
      options: {
        durable: false,
        retainInBuffer: false,
      },
    });
  });

  test("escapes html text in ui_message_delta payload", async () => {
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

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      event: {
        type: "ui_message_delta",
        messageId: calls[0]?.event.type === "ui_message_part" ? calls[0].event.messageId : "",
        partIndex: 0,
        delta: "&lt;tag&gt;",
      },
      options: {
        durable: false,
        retainInBuffer: false,
      },
    });
  });

  test("buffers reasoning chunks without broadcasting", async () => {
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
    expect(buffer.hasPendingReasoning()).toBe(true);
  });

  test("invokes finalize callback when assistant chunk type transitions", async () => {
    const session = createSession("chat-transition");
    const { runtime } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    let finalizeCalls = 0;

    const finalize = async () => {
      finalizeCalls += 1;
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
});
