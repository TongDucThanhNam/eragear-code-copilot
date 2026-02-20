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
    finalizeStreamingForCurrentAssistant: async () => undefined,
  };
}

function firstTextPart(
  message: Extract<BroadcastEvent, { type: "ui_message" }>["message"]
) {
  return message.parts.find((part) => part.type === "text");
}

function firstReasoningPart(
  message: Extract<BroadcastEvent, { type: "ui_message" }>["message"]
) {
  return message.parts.find((part) => part.type === "reasoning");
}

describe("handleBufferedMessage", () => {
  test("broadcasts assistant text as snapshot first, then deltas", async () => {
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
    expect(calls[0]?.event.type).toBe("ui_message");
    expect(calls[1]).toEqual({
      event: {
        type: "ui_message_delta",
        messageId:
          calls[0]?.event.type === "ui_message"
            ? calls[0].event.message.id
            : "",
        partIndex: 0,
        delta: " world",
      },
      options: {
        durable: false,
        retainInBuffer: false,
      },
    });

    const activeMessageId = session.uiState.currentAssistantId;
    expect(activeMessageId).toBeDefined();
    const activeMessage = activeMessageId
      ? session.uiState.messages.get(activeMessageId)
      : undefined;
    const textPart = activeMessage ? firstTextPart(activeMessage) : undefined;
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Hello world");
      expect(textPart.state).toBe("streaming");
    }
  });

  test("broadcasts reasoning as snapshot first, then deltas", async () => {
    const session = createSession("chat-stream-reasoning");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Think:" } as StoredContentBlock,
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
          content: { type: "text", text: " step-2" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.event.type).toBe("ui_message");
    expect(calls[1]).toEqual({
      event: {
        type: "ui_message_delta",
        messageId:
          calls[0]?.event.type === "ui_message"
            ? calls[0].event.message.id
            : "",
        partIndex: 0,
        delta: " step-2",
      },
      options: {
        durable: false,
        retainInBuffer: false,
      },
    });

    const activeMessageId = session.uiState.currentAssistantId;
    const activeMessage = activeMessageId
      ? session.uiState.messages.get(activeMessageId)
      : undefined;
    const reasoningPart = activeMessage
      ? firstReasoningPart(activeMessage)
      : undefined;
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.text).toBe("Think: step-2");
      expect(reasoningPart.state).toBe("streaming");
    }
  });

  test("keeps full snapshot broadcast for non-text assistant chunks", async () => {
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
    expect(calls[0]?.event.type).toBe("ui_message");
    expect(calls[0]?.options).toBeUndefined();
    if (calls[0]?.event.type === "ui_message") {
      expect(
        calls[0].event.message.parts.some((part) => part.type === "source-url")
      ).toBe(true);
    }
  });

  test("keeps one assistant message id across mixed stream chunks in a turn", async () => {
    const session = createSession("chat-stream-stable-id");
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
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Think:" } as StoredContentBlock,
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
          content: { type: "text", text: " step-2" } as StoredContentBlock,
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
    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "!" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );

    const snapshotIds = calls
      .filter(
        (
          call
        ): call is {
          event: Extract<BroadcastEvent, { type: "ui_message" }>;
          options?: SessionBroadcastOptions;
        } => call.event.type === "ui_message"
      )
      .map((call) => call.event.message.id);
    expect(snapshotIds.length).toBeGreaterThanOrEqual(1);
    const firstSnapshotId = snapshotIds[0];
    expect(firstSnapshotId).toBeDefined();
    if (!firstSnapshotId) {
      return;
    }
    for (const id of snapshotIds) {
      expect(id).toBe(firstSnapshotId);
    }

    const deltaIds = calls
      .filter(
        (
          call
        ): call is {
          event: Extract<BroadcastEvent, { type: "ui_message_delta" }>;
          options?: SessionBroadcastOptions;
        } => call.event.type === "ui_message_delta"
      )
      .map((call) => call.event.messageId);
    expect(deltaIds.length).toBeGreaterThanOrEqual(1);
    for (const id of deltaIds) {
      expect(id).toBe(firstSnapshotId);
    }

    expect(session.uiState.currentAssistantId).toBe(firstSnapshotId);
    expect(buffer.getMessageId()).toBe(firstSnapshotId);
    expect(buffer.flush()?.id).toBe(firstSnapshotId);
  });

  test("keeps streaming text on deltas without periodic snapshot anchors", async () => {
    const session = createSession("chat-stream-many-deltas");
    const { runtime, calls } = createRuntimeStub(session);
    const buffer = new SessionBuffering();
    const deltaChunks = 64;

    await handleBufferedMessage(
      createContext({
        chatId: session.id,
        buffer,
        runtime,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "A" } as StoredContentBlock,
        } as SessionUpdate,
      })
    );
    for (let index = 0; index < deltaChunks; index += 1) {
      await handleBufferedMessage(
        createContext({
          chatId: session.id,
          buffer,
          runtime,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "b" } as StoredContentBlock,
          } as SessionUpdate,
        })
      );
    }
    const snapshots = calls.filter(
      (
        call
      ): call is {
        event: Extract<BroadcastEvent, { type: "ui_message" }>;
        options?: SessionBroadcastOptions;
      } => call.event.type === "ui_message"
    );
    const deltas = calls.filter(
      (
        call
      ): call is {
        event: Extract<BroadcastEvent, { type: "ui_message_delta" }>;
        options?: SessionBroadcastOptions;
      } => call.event.type === "ui_message_delta"
    );
    expect(snapshots).toHaveLength(1);
    expect(deltas).toHaveLength(deltaChunks);
    expect(calls.at(-1)?.event.type).toBe("ui_message_delta");
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
    expect(assistantId).toBeDefined();
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
});
