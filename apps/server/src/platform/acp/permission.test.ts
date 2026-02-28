import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  SessionRuntimePort,
} from "@/modules/session";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { createPermissionHandler } from "./permission";

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
): SessionRuntimePort {
  return {
    get: (chatId: string) => (chatId === session.id ? session : undefined),
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

describe("createPermissionHandler", () => {
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
          event.type === "ui_message_part" &&
          event.part.type === "tool-execute"
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
});
