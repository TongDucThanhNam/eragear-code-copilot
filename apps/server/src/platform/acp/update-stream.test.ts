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
import { flushThrottledBroadcasts } from "./broadcast-throttle";
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
    turnIdResolution: resolveSessionUpdateTurnId(params.update),
    sessionRuntime: params.runtime,
    sessionRepo: {} as SessionRepositoryPort,
    finalizeStreamingForCurrentAssistant:
      params.finalizeStreamingForCurrentAssistant ?? (async () => undefined),
  };
}

describe("handleBufferedMessage", () => {
  test("streams text chunks as create-plus-part events", async () => {
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
    await flushThrottledBroadcasts(session.id);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    expect(calls[1]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.partId).toEqual(expect.any(String));
      expect(calls[0].event.isNew).toBe(true);
      expect(calls[0].event.partIndex).toBe(0);
      expect(calls[0].event.part.type).toBe("text");
      if (calls[0].event.part.type === "text") {
        expect(calls[0].event.part.text).toBe("Hello");
      }
    }
    if (calls[1]?.event.type === "ui_message_part") {
      expect(calls[1].event.isNew).toBe(false);
      expect(calls[1].event.partIndex).toBe(0);
      expect(calls[1].event.part.type).toBe("text");
      if (calls[1].event.part.type === "text") {
        expect(calls[1].event.part.text).toBe("Hello world");
      }
    }
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

  test("coalesces long text streams into the latest part snapshot", async () => {
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
    await flushThrottledBroadcasts(session.id);

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.event.type === "ui_message_part")).toBe(
      true
    );
    if (calls[1]?.event.type === "ui_message_part") {
      expect(calls[1].event.isNew).toBe(false);
      expect(calls[1].event.part.type).toBe("text");
      if (calls[1].event.part.type === "text") {
        expect(calls[1].event.part.text).toBe(chunk.repeat(200));
      }
    }
  });

  test("stores escaped html text in part snapshots", async () => {
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
    await flushThrottledBroadcasts(session.id);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    expect(calls[1]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.part.type).toBe("text");
      if (calls[0].event.part.type === "text") {
        expect(calls[0].event.part.text).toBe("safe");
      }
    }
    if (calls[1]?.event.type === "ui_message_part") {
      expect(calls[1].event.part.type).toBe("text");
      if (calls[1].event.part.type === "text") {
        expect(calls[1].event.part.text).toBe("safe&lt;tag&gt;");
      }
    }
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

  test("streams reasoning chunks as create-plus-part events", async () => {
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
    await flushThrottledBroadcasts(session.id);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    expect(calls[1]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.partId).toEqual(expect.any(String));
      expect(calls[0].event.isNew).toBe(true);
      expect(calls[0].event.partIndex).toBe(0);
      expect(calls[0].event.part.type).toBe("reasoning");
      if (calls[0].event.part.type === "reasoning") {
        expect(calls[0].event.part.text).toBe("think-1");
      }
    }
    if (calls[1]?.event.type === "ui_message_part") {
      expect(calls[1].event.isNew).toBe(false);
      expect(calls[1].event.partIndex).toBe(0);
      expect(calls[1].event.part.type).toBe("reasoning");
      if (calls[1].event.part.type === "reasoning") {
        expect(calls[1].event.part.text).toBe("think-1 think-2");
      }
    }
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
    await flushThrottledBroadcasts(session.id);

    const partEvents = calls.filter(
      (call) => call.event.type === "ui_message_part"
    );
    expect(partEvents).toHaveLength(2);
    const first = partEvents[0];
    const second = partEvents[1];
    if (first?.event.type === "ui_message_part") {
      expect(first.event.partIndex).toBe(0);
      expect(first.event.part.type).toBe("reasoning");
      expect(first.event.isNew).toBe(true);
    }
    if (second?.event.type === "ui_message_part") {
      expect(second.event.partIndex).toBe(1);
      expect(second.event.part.type).toBe("text");
      if (second.event.part.type === "text") {
        expect(second.event.part.text).toBe("answer");
      }
      expect(second.event.isNew).toBe(true);
    }

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

  test("ignores live user_message_chunk outside replay mode", async () => {
    const session = createSession("chat-stream-live-user-chunk");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

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

    expect(handled).toBe(false);
    expect(calls).toHaveLength(0);
    expect(session.uiState.currentUserId).toBeUndefined();
    expect(session.uiState.messages.size).toBe(0);
  });

  test("emits turnId on live assistant streaming events", async () => {
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
    await flushThrottledBroadcasts(session.id);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message_part");
    expect(calls[1]?.event.type).toBe("ui_message_part");
    if (calls[0]?.event.type === "ui_message_part") {
      expect(calls[0].event.turnId).toBe("turn-live");
    }
    if (calls[1]?.event.type === "ui_message_part") {
      expect(calls[1].event.turnId).toBe("turn-live");
    }
  });
});
