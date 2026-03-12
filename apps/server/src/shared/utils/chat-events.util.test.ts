import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { maybeBroadcastChatFinish, updateChatStatus } from "./chat-events.util";

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

describe("updateChatStatus", () => {
  test("broadcasts turnId for active statuses", async () => {
    const session = createSession({ chatStatus: "submitted", activeTurnId: "turn-1" });
    const events: BroadcastEvent[] = [];

    await updateChatStatus({
      chatId: "chat-1",
      session,
      broadcast: async (_chatId, event) => {
        events.push(event);
      },
      status: "streaming",
    });

    expect(events).toEqual([
      {
        type: "chat_status",
        status: "streaming",
        turnId: "turn-1",
      },
    ]);
  });

  test("does not broadcast turnId for inactive status", async () => {
    const session = createSession({ chatStatus: "streaming", activeTurnId: "turn-stale" });
    const events: BroadcastEvent[] = [];

    await updateChatStatus({
      chatId: "chat-1",
      session,
      broadcast: async (_chatId, event) => {
        events.push(event);
      },
      status: "inactive",
      turnId: "turn-explicit",
    });

    expect(events).toEqual([
      {
        type: "chat_status",
        status: "inactive",
      },
    ]);
  });

  test("skips broadcast when status is unchanged", async () => {
    const session = createSession({ chatStatus: "ready" });
    const events: BroadcastEvent[] = [];

    await updateChatStatus({
      chatId: "chat-1",
      session,
      broadcast: async (_chatId, event) => {
        events.push(event);
      },
      status: "ready",
    });

    expect(events).toEqual([]);
  });
});

describe("maybeBroadcastChatFinish", () => {
  test("stores reconnect replay when turn completes without subscribers", async () => {
    const session = createSession({
      subscriberCount: 0,
      chatFinish: {
        stopReason: "end_turn",
        messageId: "msg-1",
        turnId: "turn-1",
      },
    });
    session.uiState.messages.set("msg-1", {
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "done", state: "done" }],
    });
    const events: BroadcastEvent[] = [];

    await maybeBroadcastChatFinish({
      chatId: session.id,
      session,
      broadcast: async (_chatId, event) => {
        events.push(event);
      },
    });

    expect(events).toHaveLength(1);
    const finishEvent = events[0];
    expect(finishEvent?.type).toBe("chat_finish");
    if (finishEvent?.type !== "chat_finish") {
      throw new Error("Expected chat_finish event");
    }
    expect(session.pendingReconnectChatFinish?.event).toEqual(finishEvent);
    expect(session.pendingReconnectChatFinish?.createdAtMs).toEqual(
      expect.any(Number)
    );
    expect(session.chatFinish).toBeUndefined();
  });

  test("does not store reconnect replay when subscribers were live", async () => {
    const session = createSession({
      subscriberCount: 2,
      chatFinish: {
        stopReason: "end_turn",
        messageId: "msg-2",
        turnId: "turn-2",
      },
    });
    session.uiState.messages.set("msg-2", {
      id: "msg-2",
      role: "assistant",
      parts: [{ type: "text", text: "done", state: "done" }],
    });

    await maybeBroadcastChatFinish({
      chatId: session.id,
      session,
      broadcast: async () => undefined,
    });

    expect(session.pendingReconnectChatFinish).toBeUndefined();
    expect(session.chatFinish).toBeUndefined();
  });
});
