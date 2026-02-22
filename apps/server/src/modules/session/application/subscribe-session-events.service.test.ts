import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SubscribeSessionEventsService } from "./subscribe-session-events.service";

function createSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: "chat-1",
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
    chatStatus: "ready",
    ...overrides,
  };
}

function createSessionRuntime(session: ChatSession): SessionRuntimePort {
  const sessions = new Map<string, ChatSession>([[session.id, session]]);
  const lockDepthByChat = new Map<string, number>();
  return {
    set(chatId, nextSession) {
      sessions.set(chatId, nextSession);
    },
    get(chatId) {
      return sessions.get(chatId);
    },
    delete(chatId) {
      sessions.delete(chatId);
    },
    deleteIfMatch(chatId, expectedSession) {
      const current = sessions.get(chatId);
      if (!current || current !== expectedSession) {
        return false;
      }
      sessions.delete(chatId);
      return true;
    },
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive(_chatId, work) {
      const depth = lockDepthByChat.get(_chatId) ?? 0;
      lockDepthByChat.set(_chatId, depth + 1);
      return Promise.resolve(work()).finally(() => {
        const nextDepth = (lockDepthByChat.get(_chatId) ?? 1) - 1;
        if (nextDepth <= 0) {
          lockDepthByChat.delete(_chatId);
        } else {
          lockDepthByChat.set(_chatId, nextDepth);
        }
      });
    },
    isLockHeld(chatId) {
      return (lockDepthByChat.get(chatId) ?? 0) > 0;
    },
    broadcast() {
      return Promise.resolve();
    },
  };
}

describe("SubscribeSessionEventsService", () => {
  test("reconciles orphan busy status to ready", async () => {
    const session = createSession({
      chatStatus: "streaming",
    });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = await service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("ready");
    expect(subscription.activeTurnId).toBeUndefined();
    expect(session.chatStatus).toBe("ready");
  });

  test("keeps awaiting permission when pending permission exists", async () => {
    const pendingPermissions = new Map<
      string,
      {
        resolve: (decision: unknown) => void;
        options: unknown[];
      }
    >();
    pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [],
    });
    const session = createSession({
      chatStatus: "streaming",
      pendingPermissions,
    });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = await service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("awaiting_permission");
    expect(session.chatStatus).toBe("awaiting_permission");
  });

  test("does not reconcile active busy turn", async () => {
    const activeTurnId = "turn-1";
    const session = createSession({
      chatStatus: "streaming",
      activeTurnId,
      activePromptTask: {
        turnId: activeTurnId,
        promise: Promise.resolve(),
      },
    });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = await service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("streaming");
    expect(subscription.activeTurnId).toBe(activeTurnId);
  });

  test("adds active assistant snapshot when replay buffer is missing it", async () => {
    const uiState = createUiMessageState();
    const assistantMessage: UIMessage = {
      id: "msg-active",
      role: "assistant",
      parts: [{ type: "text", text: "streaming text", state: "streaming" }],
    };
    uiState.messages.set(assistantMessage.id, assistantMessage);
    uiState.currentAssistantId = assistantMessage.id;
    const session = createSession({ uiState, messageBuffer: [] });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = await service.execute("user-1", "chat-1");

    expect(subscription.bufferedEvents).toEqual([
      {
        type: "ui_message",
        message: assistantMessage,
      },
    ]);
  });

  test("does not duplicate active assistant snapshot when already buffered", async () => {
    const uiState = createUiMessageState();
    const assistantMessage: UIMessage = {
      id: "msg-active",
      role: "assistant",
      parts: [{ type: "text", text: "ready text", state: "done" }],
    };
    uiState.messages.set(assistantMessage.id, assistantMessage);
    uiState.currentAssistantId = assistantMessage.id;
    const session = createSession({
      uiState,
      messageBuffer: [{ type: "ui_message", message: assistantMessage }],
    });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = await service.execute("user-1", "chat-1");

    expect(subscription.bufferedEvents).toHaveLength(1);
    expect(subscription.bufferedEvents[0]).toEqual({
      type: "ui_message",
      message: assistantMessage,
    });
  });

  test("queues live events emitted before subscribe listener is attached", async () => {
    const session = createSession();
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);
    const subscription = await service.execute("user-1", "chat-1");
    const deltaEvent = {
      type: "ui_message_delta" as const,
      messageId: "msg-1",
      partIndex: 0,
      delta: "queued",
    };

    session.emitter.emit("data", deltaEvent);

    const received: unknown[] = [];
    const unsubscribe = subscription.subscribe((event) => {
      received.push(event);
    });

    expect(received).toEqual([deltaEvent]);
    unsubscribe();
    await subscription.release();
  });
});
