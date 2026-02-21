import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { SetModelService } from "./set-model.service";

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
    models: {
      currentModelId: "model-1",
      availableModels: [
        { modelId: "model-1", name: "Model 1" },
        { modelId: "model-2", name: "Model 2" },
        { modelId: "model-3", name: "Model 3" },
      ],
    },
  } as unknown as ChatSession;
}

function createGateway(params: {
  session: ChatSession;
  setSessionModel: (session: ChatSession, modelId: string) => Promise<void>;
}): AiSessionRuntimePort {
  const aggregate = new SessionRuntimeEntity(params.session);
  return {
    requireAuthorizedSession: () => params.session,
    requireAuthorizedRuntime: () => aggregate,
    assertSessionRunning: () => undefined,
    prompt: async () => ({ stopReason: "end_turn" }),
    cancelPrompt: async () => undefined,
    setSessionMode: async () => undefined,
    setSessionModel: params.setSessionModel,
    setSessionConfigOption: async () => [],
    stopAndCleanup: async () => undefined,
    clearPendingPermissionsAsCancelled: () => undefined,
  };
}

describe("SetModelService", () => {
  test("serializes concurrent model switches in chat order", async () => {
    const session = createSession();
    const sessionRuntime = createSessionRuntimeStub();
    const firstRequestRelease = createDeferred<void>();
    const callSequence: string[] = [];
    let callCount = 0;

    const service = new SetModelService(
      sessionRuntime,
      createGateway({
        session,
        setSessionModel: async (_session, modelId) => {
          callCount += 1;
          callSequence.push(`${modelId}:start`);
          if (callCount === 1) {
            await firstRequestRelease.promise;
          }
          callSequence.push(`${modelId}:end`);
        },
      })
    );

    const first = service.execute("user-1", "chat-1", "model-2");
    await flushAsync();
    const second = service.execute("user-1", "chat-1", "model-3");
    await flushAsync();

    expect(callCount).toBe(1);
    expect(callSequence).toEqual(["model-2:start"]);

    firstRequestRelease.resolve();
    await Promise.all([first, second]);

    expect(callCount).toBe(2);
    expect(callSequence).toEqual([
      "model-2:start",
      "model-2:end",
      "model-3:start",
      "model-3:end",
    ]);
    expect(session.models?.currentModelId).toBe("model-3");
  });
});
