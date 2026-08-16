import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type { AppConfigService } from "#runtime/modules/settings";
import type { ChatSession } from "#runtime/shared/types/session.types";
import { createUiMessageState } from "#runtime/shared/utils/ui-message.util";
import { createSessionIdleCleanupTask } from "./session-idle-cleanup.task";

function createSession(): ChatSession {
  return {
    id: "chat-1",
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "C:/project",
    emitter: new EventEmitter(),
    cwd: "C:/project",
    subscriberCount: 0,
    idleSinceAt: 1,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "submitted",
  };
}

function createRuntime(session: ChatSession): SessionRuntimePort {
  const sessions = new Map([[session.id, session]]);
  return {
    set(chatId, next) {
      sessions.set(chatId, next);
    },
    get(chatId) {
      return sessions.get(chatId);
    },
    delete(chatId) {
      sessions.delete(chatId);
    },
    deleteIfMatch(chatId, expectedSession) {
      if (sessions.get(chatId) !== expectedSession) {
        return false;
      }
      return sessions.delete(chatId);
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
    isLockHeld() {
      return false;
    },
    broadcast() {
      return Promise.resolve();
    },
  };
}

describe("session idle cleanup", () => {
  test.each([
    [
      "active turn",
      (session: ChatSession) => {
        session.activeTurnId = "turn-1";
      },
    ],
    [
      "active prompt task",
      (session: ChatSession) => {
        session.activePromptTask = {
          turnId: "turn-1",
          promise: Promise.resolve(),
        };
      },
    ],
  ])("does not terminate a subscriberless %s", async (_label, activate) => {
    const session = createSession();
    activate(session);
    const sessionRuntime = createRuntime(session);
    const statusCalls: string[] = [];
    const sessionRepo = {
      updateStatus: () => {
        statusCalls.push("update");
        return Promise.resolve();
      },
    } as unknown as SessionRepositoryPort;
    const appConfig = {
      getConfig: () => ({ sessionIdleTimeoutMs: 1 }),
    } as AppConfigService;

    const task = createSessionIdleCleanupTask({
      sessionRuntime,
      sessionRepo,
      appConfig,
    });
    const result = await task.run();

    expect(result).toEqual({ checked: 1, cleaned: 0 });
    expect(sessionRuntime.get(session.id)).toBe(session);
    expect(session.idleSinceAt).toBeUndefined();
    expect(statusCalls).toEqual([]);
  });
});
