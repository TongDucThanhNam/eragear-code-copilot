import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { SetModeService } from "./set-mode.service";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createSessionRuntimeStub(): SessionRuntimePort {
  const sessions = new Map<string, ChatSession>();
  const lockTails = new Map<string, Promise<void>>();
  const heldLocks = new Set<string>();

  return {
    set(chatId, session) {
      sessions.set(chatId, session);
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
    async runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T> {
      const previousTail = lockTails.get(chatId) ?? Promise.resolve();
      let releaseLock: () => void = () => undefined;
      const lockSignal = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const nextTail = previousTail.then(
        () => lockSignal,
        () => lockSignal
      );
      lockTails.set(chatId, nextTail);

      await previousTail.catch(() => undefined);
      heldLocks.add(chatId);
      try {
        return await work();
      } finally {
        heldLocks.delete(chatId);
        releaseLock();
        if (lockTails.get(chatId) === nextTail) {
          lockTails.delete(chatId);
        }
      }
    },
    isLockHeld(chatId) {
      return heldLocks.has(chatId);
    },
    broadcast(_chatId: string, _event: BroadcastEvent) {
      return Promise.resolve();
    },
  };
}

function createSession(): ChatSession {
  return {
    id: "chat-1",
    userId: "user-1",
    modes: {
      currentModeId: "code",
      availableModes: [
        { id: "code", name: "Code" },
        { id: "architect", name: "Architect" },
        { id: "review", name: "Review" },
      ],
    },
  } as unknown as ChatSession;
}

function createGateway(params: {
  session: ChatSession;
  setSessionMode: (session: ChatSession, modeId: string) => Promise<void>;
}): AiSessionRuntimePort {
  const aggregate = new SessionRuntimeEntity(params.session);
  return {
    requireAuthorizedSession: () => params.session,
    requireAuthorizedRuntime: () => aggregate,
    assertSessionRunning: () => undefined,
    prompt: async () => ({ stopReason: "end_turn" }),
    cancelPrompt: async () => undefined,
    setSessionMode: params.setSessionMode,
    setSessionModel: async () => undefined,
    setSessionConfigOption: async () => [],
    stopAndCleanup: async () => undefined,
    clearPendingPermissionsAsCancelled: () => undefined,
  };
}

describe("SetModeService", () => {
  test("serializes concurrent mode switches in chat order", async () => {
    const session = createSession();
    const sessionRuntime = createSessionRuntimeStub();
    const firstRequestRelease = createDeferred<void>();
    const callSequence: string[] = [];
    let callCount = 0;

    const service = new SetModeService(
      sessionRuntime,
      createGateway({
        session,
        setSessionMode: async (_session, modeId) => {
          callCount += 1;
          callSequence.push(`${modeId}:start`);
          if (callCount === 1) {
            await firstRequestRelease.promise;
          }
          callSequence.push(`${modeId}:end`);
        },
      })
    );

    const first = service.execute("user-1", "chat-1", "architect");
    await flushAsync();
    const second = service.execute("user-1", "chat-1", "review");
    await flushAsync();

    expect(callCount).toBe(1);
    expect(callSequence).toEqual(["architect:start"]);

    firstRequestRelease.resolve();
    await Promise.all([first, second]);

    expect(callCount).toBe(2);
    expect(callSequence).toEqual([
      "architect:start",
      "architect:end",
      "review:start",
      "review:end",
    ]);
    expect(session.modes?.currentModeId).toBe("review");
  });

  test("calls agent even when requested mode is already current", async () => {
    const session = createSession();
    const sessionRuntime = createSessionRuntimeStub();
    let callCount = 0;

    const service = new SetModeService(
      sessionRuntime,
      createGateway({
        session,
        setSessionMode: () => {
          callCount += 1;
          return Promise.resolve();
        },
      })
    );

    await service.execute("user-1", "chat-1", "code");

    expect(callCount).toBe(1);
    expect(session.modes?.currentModeId).toBe("code");
  });

  test("does not hold session runtime lock while awaiting mode RPC", async () => {
    const session = createSession();
    const sessionRuntime = createSessionRuntimeStub();
    const releaseRpc = createDeferred<void>();
    let lockHeldDuringRpc = true;

    const service = new SetModeService(
      sessionRuntime,
      createGateway({
        session,
        setSessionMode: async () => {
          lockHeldDuringRpc = sessionRuntime.isLockHeld("chat-1");
          await releaseRpc.promise;
        },
      })
    );

    const pending = service.execute("user-1", "chat-1", "architect");
    await flushAsync();

    expect(lockHeldDuringRpc).toBe(false);

    releaseRpc.resolve();
    await pending;
  });
});
