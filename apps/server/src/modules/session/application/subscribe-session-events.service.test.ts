import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
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
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive(_chatId, work) {
      return work();
    },
    broadcast() {
      return Promise.resolve();
    },
  };
}

describe("SubscribeSessionEventsService", () => {
  test("reconciles orphan busy status to ready", () => {
    const session = createSession({
      chatStatus: "streaming",
    });
    const runtime = createSessionRuntime(session);
    const service = new SubscribeSessionEventsService(runtime);

    const subscription = service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("ready");
    expect(subscription.activeTurnId).toBeUndefined();
    expect(session.chatStatus).toBe("ready");
  });

  test("keeps awaiting permission when pending permission exists", () => {
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

    const subscription = service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("awaiting_permission");
    expect(session.chatStatus).toBe("awaiting_permission");
  });

  test("does not reconcile active busy turn", () => {
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

    const subscription = service.execute("user-1", "chat-1");

    expect(subscription.chatStatus).toBe("streaming");
    expect(subscription.activeTurnId).toBe(activeTurnId);
  });
});
