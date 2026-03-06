import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { createPermissionHandler } from "./permission";
import { scheduleThrottledBroadcast } from "./broadcast-throttle";
import {
  getTurnIdMigrationSnapshot,
  resetTurnIdMigrationSnapshotForTests,
} from "./turn-id-observability";

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
    chatStatus: "ready",
  };
}

function createRuntime(
  session: ChatSession,
  events: BroadcastEvent[] = []
): SessionRuntimePort & { runExclusiveCalls: number } {
  const heldLocks = new Set<string>();
  let runExclusiveCalls = 0;
  return {
    get: (chatId: string) => (chatId === session.id ? session : undefined),
    set: () => undefined,
    delete: () => undefined,
    deleteIfMatch: () => true,
    has: () => true,
    getAll: () => [session],
    runExclusive: async (chatId, work) => {
      runExclusiveCalls += 1;
      heldLocks.add(chatId);
      try {
        return await work();
      } finally {
        heldLocks.delete(chatId);
      }
    },
    isLockHeld: (chatId) => heldLocks.has(chatId),
    broadcast: (_chatId, event) => {
      events.push(event);
      return Promise.resolve();
    },
    get runExclusiveCalls() {
      return runExclusiveCalls;
    },
  } as SessionRuntimePort & { runExclusiveCalls: number };
}

describe("createPermissionHandler", () => {
  afterEach(() => {
    ENV.acpTurnIdPolicy = "compat";
    resetTurnIdMigrationSnapshotForTests();
  });

  test("emits permission updates via ui_message_part without full ui_message snapshot", async () => {
    const session = createSession("chat-1");
    const events: BroadcastEvent[] = [];
    const runtime = createRuntime(session, events);
    const handler = createPermissionHandler(runtime);

    const responsePromise = handler({
      chatId: "chat-1",
      isReplayingHistory: false,
      request: {
        sessionId: "session-1",
        toolCall: {
          toolCallId: "tool-1",
          kind: "execute",
          title: "Run command",
          rawInput: { command: "ls" },
        },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
          { optionId: "reject_once", kind: "reject_once", name: "Reject" },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toContainEqual({
      type: "chat_status",
      status: "awaiting_permission",
    });
    expect(
      events.some(
        (event) =>
          event.type === "ui_message_part" && event.part.type === "tool-execute"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "ui_message_part" &&
          event.part.type === "data-permission-options"
      )
    ).toBe(true);
    expect(events.some((event) => event.type === "ui_message")).toBe(false);

    const pendingEntry = Array.from(session.pendingPermissions.values())[0];
    if (!pendingEntry) {
      throw new Error("Expected pending permission entry");
    }
    pendingEntry.resolve({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  test("flushes pending throttled assistant chunks before permission events", async () => {
    const session = createSession("chat-ordered-permission");
    const events: BroadcastEvent[] = [];
    const runtime = createRuntime(session, events);
    const handler = createPermissionHandler(runtime);

    scheduleThrottledBroadcast({
      chatId: "chat-ordered-permission",
      messageId: "msg-1",
      partIndex: 0,
      isNew: false,
      sessionRuntime: runtime,
      event: {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: {
          type: "text",
          text: "stream tail",
          state: "streaming",
        },
        isNew: false,
      },
      options: {
        durable: false,
        retainInBuffer: true,
      },
    });

    const responsePromise = handler({
      chatId: "chat-ordered-permission",
      isReplayingHistory: false,
      request: {
        sessionId: "session-ordered",
        toolCall: {
          toolCallId: "tool-ordered",
          kind: "execute",
          title: "Run command",
          rawInput: { command: "ls" },
        },
        options: [{ optionId: "allow_once", kind: "allow_once", name: "Allow" }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events[0]).toEqual({
      type: "ui_message_part",
      messageId: "msg-1",
      messageRole: "assistant",
      partIndex: 0,
      part: {
        type: "text",
        text: "stream tail",
        state: "streaming",
      },
      isNew: false,
    });
    expect(events[1]).toEqual({
      type: "chat_status",
      status: "awaiting_permission",
    });

    const pendingEntry = Array.from(session.pendingPermissions.values())[0];
    if (!pendingEntry) {
      throw new Error("Expected pending permission entry");
    }
    pendingEntry.resolve({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  test("releases runtime lock while waiting for user decision", async () => {
    const session = createSession("chat-2");
    const runtime = createRuntime(session);
    const handler = createPermissionHandler(runtime);

    const responsePromise = handler({
      chatId: "chat-2",
      isReplayingHistory: false,
      request: {
        sessionId: "session-2",
        toolCall: {
          toolCallId: "tool-2",
          kind: "execute",
          title: "Run command",
          rawInput: { command: "pwd" },
        },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow" },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.runExclusiveCalls).toBeGreaterThan(0);
    expect(runtime.isLockHeld("chat-2")).toBe(false);
    expect(session.pendingPermissions.size).toBe(1);

    const pendingEntry = Array.from(session.pendingPermissions.values())[0];
    if (!pendingEntry) {
      throw new Error("Expected pending permission entry");
    }
    pendingEntry.resolve({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  test("cancels stale permission requests that target a different turn", async () => {
    const session = createSession("chat-stale-permission");
    session.activeTurnId = "turn-live";
    const events: BroadcastEvent[] = [];
    const runtime = createRuntime(session, events);
    const handler = createPermissionHandler(runtime);

    await expect(
      handler({
        chatId: "chat-stale-permission",
        isReplayingHistory: false,
        request: {
          sessionId: "session-1",
          toolCall: {
            toolCallId: "tool-1",
            kind: "execute",
            title: "Run command",
            rawInput: { command: "ls" },
            _meta: { turnId: "turn-stale" },
          },
          options: [],
        },
      })
    ).resolves.toEqual({
      outcome: { outcome: "cancelled" },
    });

    expect(session.pendingPermissions.size).toBe(0);
    expect(events).toHaveLength(0);
    expect(getTurnIdMigrationSnapshot().drops.staleTurnMismatch).toBe(1);
  });

  test("cancels non-native permission requests under strict turnId policy", async () => {
    ENV.acpTurnIdPolicy = "require-native";
    const session = createSession("chat-native-permission");
    session.activeTurnId = "turn-live";
    const events: BroadcastEvent[] = [];
    const runtime = createRuntime(session, events);
    const handler = createPermissionHandler(runtime);

    await expect(
      handler({
        chatId: "chat-native-permission",
        isReplayingHistory: false,
        request: {
          sessionId: "session-1",
          toolCall: {
            toolCallId: "tool-1",
            kind: "execute",
            title: "Run command",
            rawInput: { command: "ls" },
            _meta: { turnId: "turn-live" },
          },
          options: [],
        },
      })
    ).resolves.toEqual({
      outcome: { outcome: "cancelled" },
    });

    const snapshot = getTurnIdMigrationSnapshot();
    expect(snapshot.permissionRequests.metaFallback).toBe(1);
    expect(snapshot.drops.requireNativePolicy).toBe(1);
    expect(session.pendingPermissions.size).toBe(0);
    expect(events).toHaveLength(0);
  });
});
