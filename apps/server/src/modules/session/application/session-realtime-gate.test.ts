import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ENV } from "@/config/environment";
import { AppError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionRealtimeGate } from "./session-realtime-gate";

function createLoggerStub(): LoggerPort & {
  warnings: Array<{ message: string; context?: Record<string, unknown> }>;
} {
  const warnings: Array<{
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  return {
    warnings,
    debug() {
      return undefined;
    },
    info() {
      return undefined;
    },
    warn(message, context) {
      warnings.push({ message, context });
    },
    error() {
      return undefined;
    },
  };
}

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
  const lockDepthByChat = new Map<string, number>();
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
    deleteIfMatch(chatId, expectedSession) {
      const current = sessions.get(chatId);
      if (!current || current !== expectedSession) {
        return false;
      }
      sessions.delete(chatId);
      return true;
    },
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive(chatId, work) {
      const depth = lockDepthByChat.get(chatId) ?? 0;
      lockDepthByChat.set(chatId, depth + 1);
      return Promise.resolve(work()).finally(() => {
        const nextDepth = (lockDepthByChat.get(chatId) ?? 1) - 1;
        if (nextDepth <= 0) {
          lockDepthByChat.delete(chatId);
        } else {
          lockDepthByChat.set(chatId, nextDepth);
        }
      });
    },
    isLockHeld(chatId) {
      return (lockDepthByChat.get(chatId) ?? 0) > 0;
    },
    broadcast() {
      return Promise.resolve();
    },
  };
}

describe("SessionRealtimeGate", () => {
  test("repairs subscriber count drift and rejects client prompts without listeners", () => {
    const session = createSession({
      sessionId: "agent-session-1",
      subscriberCount: 1,
    });
    const logger = createLoggerStub();
    const gate = new SessionRealtimeGate({
      sessionRuntime: createSessionRuntime(session),
      logger,
    });

    let caught: unknown;
    try {
      gate.assertPromptCanSubmit({
        chatId: "chat-1",
        session,
        source: "client",
        module: "ai",
        op: "ai.prompt.send",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("SESSION_SUBSCRIPTION_REQUIRED");
    expect(session.subscriberCount).toBe(0);
    expect(logger.warnings.map((entry) => entry.message)).toEqual([
      "SessionRealtimeGate repaired subscriber count drift",
      "SessionRealtimeGate rejected prompt without subscribers",
    ]);
  });

  test("allows automation prompts without realtime subscribers", () => {
    const session = createSession();
    const gate = new SessionRealtimeGate({
      sessionRuntime: createSessionRuntime(session),
      logger: createLoggerStub(),
    });

    expect(() =>
      gate.assertPromptCanSubmit({
        chatId: "chat-1",
        session,
        source: "automation",
        module: "ai",
        op: "ai.prompt.send",
      })
    ).not.toThrow();
  });

  test("prepares subscriptions by clearing idle and no-subscriber abort state", () => {
    const timer = setTimeout(() => undefined, 1000);
    timer.unref?.();
    const session = createSession({
      idleSinceAt: 123,
      chatStatus: "streaming",
      activePromptTask: {
        turnId: "turn-1",
        promise: Promise.resolve(),
        noSubscriberAbortTimer: timer,
        noSubscriberAbortReason: "orphaned",
        orphanedSinceAt: 456,
      },
    });
    const gate = new SessionRealtimeGate({
      sessionRuntime: createSessionRuntime(session),
      logger: createLoggerStub(),
    });

    const status = gate.prepareSubscription(session);

    expect(status).toBe("streaming");
    expect(session.idleSinceAt).toBeUndefined();
    expect(session.activePromptTask?.noSubscriberAbortTimer).toBeUndefined();
    expect(session.activePromptTask?.noSubscriberAbortReason).toBeUndefined();
    expect(session.activePromptTask?.orphanedSinceAt).toBeUndefined();
  });

  test("reconciles stale busy status for subscriptions without active work", () => {
    const session = createSession({ chatStatus: "streaming" });
    const gate = new SessionRealtimeGate({
      sessionRuntime: createSessionRuntime(session),
      logger: createLoggerStub(),
    });

    const status = gate.prepareSubscription(session);

    expect(status).toBe("ready");
    expect(session.chatStatus).toBe("ready");
  });

  test("aborts orphaned prompts after the subscriber grace period", async () => {
    const originalGraceMs = ENV.promptNoSubscriberAbortGraceMs;
    ENV.promptNoSubscriberAbortGraceMs = 5;
    try {
      const abortController = new AbortController();
      const session = createSession({
        activePromptTask: {
          turnId: "turn-1",
          promise: new Promise<void>(() => undefined),
          abortController,
        },
      });
      const listener = () => undefined;
      session.emitter.on("data", listener);
      session.subscriberCount = 1;
      const gate = new SessionRealtimeGate({
        sessionRuntime: createSessionRuntime(session),
        logger: createLoggerStub(),
      });

      session.emitter.off("data", listener);
      await gate.releaseSubscription({ chatId: "chat-1", session });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(session.subscriberCount).toBe(0);
      expect(abortController.signal.aborted).toBe(true);
      expect(abortController.signal.reason).toBe(
        "Prompt aborted after realtime subscribers disconnected"
      );
    } finally {
      ENV.promptNoSubscriberAbortGraceMs = originalGraceMs;
    }
  });
});
