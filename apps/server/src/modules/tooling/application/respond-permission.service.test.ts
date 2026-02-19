import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionRuntimePort } from "@/modules/session";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { RespondPermissionService } from "./respond-permission.service";

const CHAT_NOT_FOUND_RE = /chat not found/i;

function createSession(userId: string): ChatSession {
  return {
    id: "chat-1",
    userId,
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
): SessionRuntimePort {
  return {
    get: () => session,
    set: () => undefined,
    delete: () => undefined,
    has: () => true,
    getAll: () => [session],
    runExclusive: async (_chatId, work) => await work(),
    broadcast: async (_chatId, event) => {
      events.push(event);
    },
  } as SessionRuntimePort;
}

describe("RespondPermissionService", () => {
  test("rejects cross-user permission response", async () => {
    const session = createSession("user-2");
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [],
    });
    const service = new RespondPermissionService(createRuntime(session));

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow",
      })
    ).rejects.toThrow(CHAT_NOT_FOUND_RE);
  });

  test("resolves pending permission for owning user", async () => {
    const session = createSession("user-1");
    const decisions: unknown[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: (decision) => decisions.push(decision),
      options: [],
    });
    const service = new RespondPermissionService(createRuntime(session));

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow",
      })
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(decisions).toEqual([
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(session.pendingPermissions.size).toBe(0);
  });

  test("sets ready when final permission resolves without active turn", async () => {
    const session = createSession("user-1");
    const events: BroadcastEvent[] = [];
    session.chatStatus = "awaiting_permission";
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [],
    });
    const service = new RespondPermissionService(createRuntime(session, events));

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      requestId: "req-1",
      decision: "allow",
    });

    expect(session.chatStatus as ChatSession["chatStatus"]).toBe("ready");
    expect(events).toContainEqual({
      type: "chat_status",
      status: "ready",
    });
  });

  test("sets streaming when final permission resolves with active turn", async () => {
    const session = createSession("user-1");
    const events: BroadcastEvent[] = [];
    session.chatStatus = "awaiting_permission";
    session.activeTurnId = "turn-1";
    session.activePromptTask = {
      turnId: "turn-1",
      promise: Promise.resolve(),
    };
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [],
    });
    const service = new RespondPermissionService(createRuntime(session, events));

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      requestId: "req-1",
      decision: "allow",
    });

    expect(session.chatStatus as ChatSession["chatStatus"]).toBe("streaming");
    expect(events).toContainEqual({
      type: "chat_status",
      status: "streaming",
      turnId: "turn-1",
    });
  });
});
