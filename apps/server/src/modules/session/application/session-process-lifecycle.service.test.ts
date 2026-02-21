import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionProcessLifecycleService } from "./session-process-lifecycle.service";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";

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
    chatStatus: "streaming",
  };
}

function createRuntimeStub(session: ChatSession): {
  runtime: SessionRuntimePort;
  events: BroadcastEvent[];
  deleteCalls: number;
} {
  const sessions = new Map<string, ChatSession>([[session.id, session]]);
  const lockDepthByChat = new Map<string, number>();
  const events: BroadcastEvent[] = [];
  let deleteCalls = 0;

  const runtime = {
    set(chatId: string, next: ChatSession) {
      sessions.set(chatId, next);
    },
    get(chatId: string) {
      return sessions.get(chatId);
    },
    delete(chatId: string) {
      deleteCalls += 1;
      sessions.delete(chatId);
    },
    deleteIfMatch(chatId: string, expectedSession: ChatSession) {
      const current = sessions.get(chatId);
      if (!current || current !== expectedSession) {
        return false;
      }
      deleteCalls += 1;
      sessions.delete(chatId);
      return true;
    },
    has(chatId: string) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive<T>(chatId: string, work: () => Promise<T>) {
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
    isLockHeld(chatId: string) {
      return (lockDepthByChat.get(chatId) ?? 0) > 0;
    },
    async broadcast(_chatId: string, event: BroadcastEvent) {
      events.push(event);
    },
  } as SessionRuntimePort;

  return {
    runtime,
    events,
    get deleteCalls() {
      return deleteCalls;
    },
  };
}

function createRepoStub() {
  const statusCalls: Array<{
    id: string;
    userId: string;
    status: "running" | "stopped";
  }> = [];
  const repo = {
    updateStatus: async (
      id: string,
      userId: string,
      status: "running" | "stopped"
    ) => {
      statusCalls.push({ id, userId, status });
    },
  } as unknown as SessionRepositoryPort;
  return { repo, statusCalls };
}

function createLoggerStub() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SessionProcessLifecycleService", () => {
  test("marks session error and stopped on abnormal exit", async () => {
    const session = createSession("chat-abnormal-exit");
    const runtimeStub = createRuntimeStub(session);
    const repoStub = createRepoStub();
    const service = new SessionProcessLifecycleService(
      runtimeStub.runtime,
      repoStub.repo,
      createLoggerStub()
    );
    const proc = new EventEmitter() as ChildProcess;

    service.attach(proc, session.id);
    proc.emit("exit", 1, null);
    await flushAsync();

    expect(runtimeStub.events).toContainEqual({
      type: "error",
      error: "Agent process exited with code 1",
    });
    expect(runtimeStub.events).toContainEqual({
      type: "chat_status",
      status: "error",
    });
    expect(repoStub.statusCalls).toEqual([
      {
        id: session.id,
        userId: "user-1",
        status: "stopped",
      },
    ]);
    expect(runtimeStub.deleteCalls).toBe(1);
    expect(runtimeStub.runtime.has(session.id)).toBe(false);
  });

  test("marks session inactive on clean exit and stops once", async () => {
    const session = createSession("chat-clean-exit");
    const runtimeStub = createRuntimeStub(session);
    const repoStub = createRepoStub();
    const service = new SessionProcessLifecycleService(
      runtimeStub.runtime,
      repoStub.repo,
      createLoggerStub()
    );
    const proc = new EventEmitter() as ChildProcess;

    service.attach(proc, session.id);
    proc.emit("exit", 0, null);
    await flushAsync();

    expect(runtimeStub.events).toContainEqual({
      type: "chat_status",
      status: "inactive",
    });
    expect(
      runtimeStub.events.some(
        (event) => event.type === "error" && event.error.includes("exited")
      )
    ).toBe(false);
    expect(repoStub.statusCalls).toEqual([
      {
        id: session.id,
        userId: "user-1",
        status: "stopped",
      },
    ]);
    expect(runtimeStub.deleteCalls).toBe(1);
  });

  test("handles duplicate lifecycle signals idempotently", async () => {
    const session = createSession("chat-idempotent");
    const runtimeStub = createRuntimeStub(session);
    const repoStub = createRepoStub();
    const service = new SessionProcessLifecycleService(
      runtimeStub.runtime,
      repoStub.repo,
      createLoggerStub()
    );
    const proc = new EventEmitter() as ChildProcess;

    service.attach(proc, session.id);
    proc.emit("error", new Error("boom"));
    proc.emit("exit", 1, null);
    proc.emit("close", 1, null);
    await flushAsync();

    expect(
      runtimeStub.events.filter((event) => event.type === "error")
    ).toHaveLength(1);
    expect(
      runtimeStub.events.filter((event) => event.type === "chat_status")
    ).toHaveLength(1);
    expect(repoStub.statusCalls).toHaveLength(1);
    expect(runtimeStub.deleteCalls).toBe(1);
  });
});
