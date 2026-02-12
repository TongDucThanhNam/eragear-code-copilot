import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { SessionMessageMapper } from "./session-message.mapper";

function createRuntime(events: BroadcastEvent[]): SessionRuntimePort {
  const session = {
    id: "chat-1",
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 1,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;

  return {
    set: () => undefined,
    get: () => session,
    delete: () => undefined,
    has: () => true,
    getAll: () => [session],
    runExclusive: async (_chatId, work) => await work(),
    broadcast: (_chatId, event) => {
      events.push(event as BroadcastEvent);
      return Promise.resolve();
    },
  };
}

describe("SessionMessageMapper", () => {
  test("maps compacted assistant messages to placeholder text", async () => {
    const events: BroadcastEvent[] = [];
    const mapper = new SessionMessageMapper(createRuntime(events));

    await mapper.broadcastStoredMessage("chat-1", {
      id: "m-1",
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isCompacted: true,
    });

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe("ui_message");
    if (event?.type === "ui_message") {
      expect(JSON.stringify(event.message)).toContain(
        "Assistant message compacted"
      );
    }
  });

  test("drops empty user messages without payload", async () => {
    const events: BroadcastEvent[] = [];
    const mapper = new SessionMessageMapper(createRuntime(events));

    await mapper.broadcastStoredMessage("chat-1", {
      id: "m-2",
      role: "user",
      content: "",
      timestamp: Date.now(),
    });

    expect(events).toHaveLength(0);
  });
});
