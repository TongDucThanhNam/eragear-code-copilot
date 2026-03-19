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

function createSessionRuntimeStub(): SessionRuntimePort & {
  broadcasts: Array<{ chatId: string; event: BroadcastEvent }>;
} {
  const sessions = new Map<string, ChatSession>();
  const lockTails = new Map<string, Promise<void>>();
  const heldLocks = new Set<string>();
  const broadcasts: Array<{ chatId: string; event: BroadcastEvent }> = [];

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
      broadcasts.push({ chatId: _chatId, event: _event });
      return Promise.resolve();
    },
    get broadcasts() {
      return broadcasts;
    },
  } satisfies SessionRuntimePort & {
    broadcasts: Array<{ chatId: string; event: BroadcastEvent }>;
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
  setSessionConfigOption?: (
    session: ChatSession,
    configId: string,
    value: string
  ) => Promise<NonNullable<ChatSession["configOptions"]>>;
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
    setSessionConfigOption:
      params.setSessionConfigOption ?? (async () => []),
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

  test("broadcasts current_mode_update after a successful switch", async () => {
    const session = createSession();
    session.configOptions = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "code",
        options: [
          { value: "code", name: "Code" },
          { value: "architect", name: "Architect" },
        ],
      },
    ] as ChatSession["configOptions"];
    const sessionRuntime = createSessionRuntimeStub();

    const service = new SetModeService(
      sessionRuntime,
      createGateway({
        session,
        setSessionMode: async () => undefined,
      })
    );

    await service.execute("user-1", "chat-1", "architect");

    expect(sessionRuntime.broadcasts).toEqual([
      {
        chatId: "chat-1",
        event: { type: "current_mode_update", modeId: "architect" },
      },
      {
        chatId: "chat-1",
        event: {
          type: "config_options_update",
          configOptions: session.configOptions!,
        },
      },
    ]);
  });

  test("uses session config options as the canonical mode mutation path", async () => {
    const session = createSession();
    session.modes = undefined;
    session.configOptions = [
      {
        id: "approvalMode",
        name: "Approval Mode",
        category: "mode",
        type: "select",
        currentValue: "code",
        options: [
          { value: "code", name: "Code" },
          { value: "architect", name: "Architect" },
        ],
      },
    ] as ChatSession["configOptions"];
    const sessionRuntime = createSessionRuntimeStub();
    const legacyCalls: string[] = [];
    const configCalls: Array<{ configId: string; value: string }> = [];

    const service = new SetModeService(
      sessionRuntime,
      createGateway({
        session,
        setSessionMode: async (_session, modeId) => {
          legacyCalls.push(modeId);
        },
        setSessionConfigOption: async (_session, configId, value) => {
          configCalls.push({ configId, value });
          return [
            {
              id: "approvalMode",
              name: "Approval Mode",
              category: "mode",
              type: "select",
              currentValue: value,
              options: [
                { value: "code", name: "Code" },
                { value: "architect", name: "Architect" },
              ],
            },
          ] as NonNullable<ChatSession["configOptions"]>;
        },
      })
    );

    await service.execute("user-1", "chat-1", "architect");

    expect(legacyCalls).toEqual([]);
    expect(configCalls).toEqual([
      {
        configId: "approvalMode",
        value: "architect",
      },
    ]);
    expect(session.configOptions?.[0]?.currentValue).toBe("architect");
    expect(session.modes!).toEqual({
      currentModeId: "architect",
      availableModes: [
        { id: "code", name: "Code", description: undefined },
        { id: "architect", name: "Architect", description: undefined },
      ],
    });
  });
});
