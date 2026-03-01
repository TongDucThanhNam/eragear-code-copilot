import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { updateChatStatus } from "./chat-events.util";

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
