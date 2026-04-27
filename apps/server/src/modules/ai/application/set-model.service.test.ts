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
    setSessionMode: async () => undefined,
    setSessionModel: params.setSessionModel,
    setSessionConfigOption: params.setSessionConfigOption ?? (async () => []),
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

  test("uses session config options as the canonical model mutation path", async () => {
    const session = createSession();
    session.models = undefined;
    session.configOptions = [
      {
        id: "primaryModel",
        name: "Primary Model",
        category: "model",
        type: "select",
        currentValue: "model-1",
        options: [
          { value: "model-1", name: "Model 1" },
          { value: "model-2", name: "Model 2" },
          { value: "model-3", name: "Model 3" },
        ],
      },
    ] as ChatSession["configOptions"];
    const sessionRuntime = createSessionRuntimeStub();
    const legacyCalls: string[] = [];
    const configCalls: Array<{ configId: string; value: string }> = [];

    const service = new SetModelService(
      sessionRuntime,
      createGateway({
        session,
        setSessionModel: async (_session, modelId) => {
          legacyCalls.push(modelId);
        },
        setSessionConfigOption: async (_session, configId, value) => {
          configCalls.push({ configId, value });
          return [
            {
              id: "primaryModel",
              name: "Primary Model",
              category: "model",
              type: "select",
              currentValue: value,
              options: [
                { value: "model-1", name: "Model 1" },
                { value: "model-2", name: "Model 2" },
                { value: "model-3", name: "Model 3" },
              ],
            },
          ] as NonNullable<ChatSession["configOptions"]>;
        },
      })
    );

    await service.execute("user-1", "chat-1", "model-2");

    expect(legacyCalls).toEqual([]);
    expect(configCalls).toEqual([
      {
        configId: "primaryModel",
        value: "model-2",
      },
    ]);
    expect(session.configOptions?.[0]?.currentValue).toBe("model-2");
    expect(session.models).toEqual({
      currentModelId: "model-2",
      availableModels: [
        { modelId: "model-1", name: "Model 1", description: undefined },
        { modelId: "model-2", name: "Model 2", description: undefined },
        { modelId: "model-3", name: "Model 3", description: undefined },
      ],
    });
    expect(sessionRuntime.broadcasts).toEqual([
      {
        chatId: "chat-1",
        event: { type: "current_model_update", modelId: "model-2" },
      },
      {
        chatId: "chat-1",
        event: {
          type: "config_options_update",
          configOptions: session.configOptions ?? null,
        },
      },
    ]);
  });

  test("set-model works with large uncapped internal state when target model is beyond client-visible cap", async () => {
    // Create a session with 150 models internally (uncapped),
    // simulating the scenario where client-visible list is capped at 100
    // but internal validation must work with full list
    const session = createSession();
    session.models = undefined;
    // Internal configOptions has 150 models - the full uncapped list
    session.configOptions = [
      {
        id: "primaryModel",
        name: "Primary Model",
        category: "model",
        type: "select",
        currentValue: "model-50",
        options: Array.from({ length: 150 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      },
    ] as ChatSession["configOptions"];

    const sessionRuntime = createSessionRuntimeStub();
    const configCalls: Array<{ configId: string; value: string }> = [];

    // Target model-120 is beyond the 100-item client-visible cap but present internally
    const service = new SetModelService(
      sessionRuntime,
      createGateway({
        session,
        setSessionModel: async () => {
          throw new Error("Should use config option path");
        },
        setSessionConfigOption: async (_session, _configId, value) => {
          configCalls.push({ configId: "primaryModel", value });
          // Return the updated config with the new selection
          return [
            {
              id: "primaryModel",
              name: "Primary Model",
              category: "model",
              type: "select",
              currentValue: value,
              options: Array.from({ length: 150 }, (_, i) => ({
                value: `model-${i}`,
                name: `Model ${i}`,
              })),
            },
          ] as NonNullable<ChatSession["configOptions"]>;
        },
      })
    );

    const result = await service.execute("user-1", "chat-1", "model-120");

    expect(result.ok).toBe(true);
    expect(configCalls).toEqual([
      {
        configId: "primaryModel",
        value: "model-120",
      },
    ]);
    expect(session.configOptions?.[0]?.currentValue).toBe("model-120");

    // Verify broadcast was sent with the uncapped internal configOptions
    const configUpdateBroadcast = sessionRuntime.broadcasts.find(
      (b) => b.event.type === "config_options_update"
    );
    expect(configUpdateBroadcast).toBeDefined();
    // The broadcast should contain the session's configOptions (uncapped)
    expect(
      (configUpdateBroadcast!.event as { configOptions: unknown }).configOptions
    ).toBe(session.configOptions);
  });

  test("set-model validates against full internal configOptions, not client-visible capped list", async () => {
    // This test verifies that validation happens against the uncapped internal state
    const session = createSession();
    session.models = undefined;
    // Internal configOptions has 150 models - uncapped
    session.configOptions = [
      {
        id: "primaryModel",
        name: "Primary Model",
        category: "model",
        type: "select",
        currentValue: "model-0",
        options: Array.from({ length: 150 }, (_, i) => ({
          value: `model-${i}`,
          name: `Model ${i}`,
        })),
      },
    ] as ChatSession["configOptions"];

    const sessionRuntime = createSessionRuntimeStub();
    let errorThrown: Error | null = null;

    const service = new SetModelService(
      sessionRuntime,
      createGateway({
        session,
        setSessionModel: () => Promise.resolve(),
        setSessionConfigOption: async () => [],
      })
    );

    // model-120 exists in the internal 150-model list but would be beyond
    // a 100-item client-visible cap. Validation should PASS because it
    // uses internal uncapped state.
    try {
      await service.execute("user-1", "chat-1", "model-120");
    } catch (err) {
      errorThrown = err as Error;
    }

    // Should NOT throw - model-120 exists in the uncapped internal list
    expect(errorThrown).toBeNull();
    expect(session.configOptions?.[0]?.currentValue).toBe("model-120");
  });
});
