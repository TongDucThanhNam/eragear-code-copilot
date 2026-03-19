import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { UIMessage } from "@repo/shared";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { SessionBufferingPort } from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionHistoryReplayService } from "./session-history-replay.service";
import type { SessionMessageMapper } from "./session-message.mapper";

function createLoggerStub(): LoggerPort {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function createBufferStub(replayEventCount: number): SessionBufferingPort {
  return {
    replayEventCount,
    appendContent: () => undefined,
    appendReasoning: () => undefined,
    consumePendingReasoning: () => null,
    hasPendingReasoning: () => false,
    getMessageId: () => null,
    ensureMessageId: () => "msg-buffer",
    flush: () => null,
    hasContent: () => false,
    reset: () => undefined,
    getContentStats: () => ({
      contentChunkCount: 0,
      contentTextLength: 0,
      contentDurationMs: null,
    }),
    resetContentStats: () => undefined,
  };
}

function createSession(chatId: string): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "connecting",
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("SessionHistoryReplayService", () => {
  test("finalizes and broadcasts current assistant message", async () => {
    const chatId = "chat-finalize";
    const session = createSession(chatId);

    const assistantMessage: UIMessage = {
      id: "msg-assistant",
      role: "assistant",
      createdAt: 200,
      parts: [
        { type: "reasoning", text: "thinking", state: "streaming" },
        { type: "text", text: "hi", state: "streaming" },
      ],
    };
    session.uiState.messages.set(assistantMessage.id, assistantMessage);
    session.uiState.currentAssistantId = assistantMessage.id;

    const broadcasts: unknown[] = [];
    const runtime = {
      get: (id: string) => (id === chatId ? session : undefined),
      broadcast: (_chatId: string, event: unknown) => {
        broadcasts.push(event);
      },
    } as unknown as SessionRuntimePort;
    const repo = {
      getMessagesPage: async () => ({
        messages: [],
        hasMore: false,
        nextCursor: undefined,
      }),
    } as unknown as SessionRepositoryPort;
    const mapper = {
      broadcastStoredMessage: () => undefined,
    } as unknown as SessionMessageMapper;

    const service = new SessionHistoryReplayService(
      repo,
      runtime,
      mapper,
      createLoggerStub()
    );

    await service.broadcastPromptEnd(chatId, createBufferStub(3));

    expect(session.uiState.currentAssistantId).toBeUndefined();
    expect(
      broadcasts.some(
        (event) =>
          (event as { type?: string }).type === "ui_message" &&
          (event as { message?: { id?: string } }).message?.id ===
            "msg-assistant"
      )
    ).toBe(true);
    const updatedMessage = session.uiState.messages.get(assistantMessage.id);
    const hasStreamingPart = updatedMessage?.parts.some(
      (part) =>
        (part.type === "text" || part.type === "reasoning") &&
        part.state === "streaming"
    );
    expect(hasStreamingPart).toBe(false);
  });

  test("replays stored messages when agent replay has no events", async () => {
    const chatId = "chat-replay-stored";
    const session = createSession(chatId);
    const mappedCalls: Array<{ chatId: string; messageId: string }> = [];
    const runtime = {
      get: (id: string) => (id === chatId ? session : undefined),
      broadcast: async () => undefined,
    } as unknown as SessionRuntimePort;
    const repo = {
      getMessagesPage: async () => ({
        messages: [
          {
            id: "msg-stored-1",
            role: "assistant",
            content: "stored",
            timestamp: 1,
          },
        ],
        hasMore: false,
        nextCursor: undefined,
      }),
    } as unknown as SessionRepositoryPort;
    const mapper = {
      broadcastStoredMessage: (
        mappedChatId: string,
        message: { id: string }
      ) => {
        mappedCalls.push({
          chatId: mappedChatId,
          messageId: message.id,
        });
      },
    } as unknown as SessionMessageMapper;

    const service = new SessionHistoryReplayService(
      repo,
      runtime,
      mapper,
      createLoggerStub()
    );

    await service.broadcastPromptEnd(chatId, createBufferStub(0));

    expect(mappedCalls).toEqual([{ chatId, messageId: "msg-stored-1" }]);
  });
});
