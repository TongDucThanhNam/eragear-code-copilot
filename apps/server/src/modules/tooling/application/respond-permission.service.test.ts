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
    deleteIfMatch: () => true,
    has: () => true,
    getAll: () => [session],
    runExclusive: async (_chatId, work) => await work(),
    isLockHeld: () => true,
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

  test("maps allow-style decision text to allow option when options exist", async () => {
    const session = createSession("user-1");
    const decisions: unknown[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: (decision) => decisions.push(decision),
      options: [
        { optionId: "accept_once", name: "Accept once", kind: "allow_once" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
      ],
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
      outcome: { outcome: "selected", optionId: "accept_once" },
    });
    expect(decisions).toEqual([
      { outcome: { outcome: "selected", optionId: "accept_once" } },
    ]);
  });

  test("accepts decision by option name token (case-insensitive)", async () => {
    const session = createSession("user-1");
    const decisions: unknown[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: (decision) => decisions.push(decision),
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
      ],
    });
    const service = new RespondPermissionService(createRuntime(session));

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "Allow once",
      })
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    expect(decisions).toEqual([
      { outcome: { outcome: "selected", optionId: "allow_once" } },
    ]);
  });

  test("treats explicitly selected custom option as approved unless intent is reject", async () => {
    const session = createSession("user-1");
    const events: BroadcastEvent[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [
        {
          optionId: "custom_execute",
          name: "Execute anyway",
        },
      ],
      toolCallId: "tool-1",
      toolName: "bash",
    });
    const service = new RespondPermissionService(createRuntime(session, events));

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "custom_execute",
      })
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "custom_execute" },
    });

    const toolPartEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" && event.part.type === "tool-bash"
    );
    expect(toolPartEvent).toBeDefined();
    expect(events.some((event) => event.type === "ui_message")).toBe(false);
    const toolPart = toolPartEvent?.part;
    expect(toolPart).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "approval-responded",
      approval: {
        id: "req-1",
        approved: true,
        reason: "custom_execute",
      },
    });
  });

  test("treats allow option ids with 'no' substrings as approved via kind", async () => {
    const session = createSession("user-1");
    const events: BroadcastEvent[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [
        {
          optionId: "allow_for_now",
          name: "Allow for now",
          kind: "allow_once",
        },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
      ],
      toolCallId: "tool-1",
      toolName: "bash",
    });
    const service = new RespondPermissionService(createRuntime(session, events));

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow_for_now",
      })
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_for_now" },
    });

    const toolPartEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" && event.part.type === "tool-bash"
    );
    expect(toolPartEvent).toBeDefined();
    expect(events.some((event) => event.type === "ui_message")).toBe(false);
    const toolPart = toolPartEvent?.part;
    expect(toolPart).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "approval-responded",
      approval: {
        id: "req-1",
        approved: true,
        reason: "allow_for_now",
      },
    });
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

  test("clears stale data-permission-options payload after response", async () => {
    const session = createSession("user-1");
    const events: BroadcastEvent[] = [];
    session.activeTurnId = "turn-1";
    session.uiState.messages.set("msg-1", {
      id: "msg-1",
      role: "assistant",
      parts: [
        {
          type: "data-permission-options",
          data: {
            requestId: "req-1",
            toolCallId: "tool-1",
            options: [{ optionId: "allow_once", kind: "allow_once" }],
          },
        },
        {
          type: "tool-bash",
          toolCallId: "tool-1",
          state: "approval-requested",
          title: "Bash",
          input: null,
          approval: { id: "req-1" },
        },
      ],
    });
    session.uiState.toolPartIndex.set("tool-1", {
      messageId: "msg-1",
      partIndex: 1,
    });
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [{ optionId: "allow_once", kind: "allow_once" }],
      toolCallId: "tool-1",
      toolName: "bash",
      title: "Bash",
      turnId: "turn-1",
    });
    const service = new RespondPermissionService(createRuntime(session, events));

    await service.execute({
      userId: "user-1",
      chatId: "chat-1",
      requestId: "req-1",
      decision: "allow",
    });

    const optionsPartEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" &&
        event.part.type === "data-permission-options"
    );
    expect(optionsPartEvent).toBeDefined();
    expect(optionsPartEvent?.turnId).toBe("turn-1");
    if (!optionsPartEvent || optionsPartEvent.part.type !== "data-permission-options") {
      throw new Error("Expected permission options part update event");
    }
    expect(optionsPartEvent.part.data).toMatchObject({
      requestId: "req-1",
      toolCallId: "tool-1",
      options: [],
    });
  });
});
