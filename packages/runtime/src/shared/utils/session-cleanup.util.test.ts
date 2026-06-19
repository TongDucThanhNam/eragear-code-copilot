import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChatSession } from "../types/session.types";
import { terminateSessionTerminals } from "./session-cleanup.util";
import { createUiMessageState } from "./ui-message.util";

function createSession(): ChatSession {
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
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("terminateSessionTerminals", () => {
  test("cancels pending permissions during teardown", async () => {
    const decisions: unknown[] = [];
    const session = createSession();
    session.pendingPermissions.set("req-1", {
      resolve: (decision: unknown) => {
        decisions.push(decision);
      },
      options: [],
    });

    await terminateSessionTerminals(session);

    expect(decisions).toEqual([{ outcome: { outcome: "cancelled" } }]);
    expect(session.pendingPermissions.size).toBe(0);
  });
});
