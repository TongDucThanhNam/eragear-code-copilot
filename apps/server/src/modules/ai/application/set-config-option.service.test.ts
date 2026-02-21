import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";
import { SetConfigOptionService } from "./set-config-option.service";

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

function createSelectOption(params: {
  id: string;
  name: string;
  category: string;
  currentValue: string;
  values: string[];
}): SessionConfigOption {
  return {
    id: params.id,
    name: params.name,
    category: params.category,
    type: "select",
    currentValue: params.currentValue,
    options: params.values.map((value) => ({
      value,
      name: value,
    })),
  };
}

function createSession(): ChatSession {
  return {
    id: "chat-1",
    userId: "user-1",
    configOptions: [
      createSelectOption({
        id: "mode",
        name: "Mode",
        category: "mode",
        currentValue: "code",
        values: ["code", "architect"],
      }),
      createSelectOption({
        id: "reasoning",
        name: "Reasoning",
        category: "thought_level",
        currentValue: "low",
        values: ["low", "high"],
      }),
    ],
    modes: {
      currentModeId: "code",
      availableModes: [
        { id: "code", name: "Code" },
        { id: "architect", name: "Architect" },
      ],
    },
    models: {
      currentModelId: "model-1",
      availableModels: [{ modelId: "model-1", name: "Model 1" }],
    },
  } as unknown as ChatSession;
}

function createGateway(params: {
  session: ChatSession;
  setSessionConfigOption: (
    session: ChatSession,
    configId: string,
    value: string
  ) => Promise<SessionConfigOption[]>;
}): AiSessionRuntimePort {
  const aggregate = new SessionRuntimeEntity(params.session);
  return {
    requireAuthorizedSession: () => params.session,
    requireAuthorizedRuntime: () => aggregate,
    assertSessionRunning: () => undefined,
    prompt: async () => ({ stopReason: "end_turn" }),
    cancelPrompt: async () => undefined,
    setSessionMode: async () => undefined,
    setSessionModel: async () => undefined,
    setSessionConfigOption: params.setSessionConfigOption,
    stopAndCleanup: async () => undefined,
    clearPendingPermissionsAsCancelled: () => undefined,
  };
}

describe("SetConfigOptionService", () => {
  test("serializes concurrent config updates and keeps the latest response", async () => {
    const session = createSession();
    const sessionRuntime = createSessionRuntimeStub();
    const firstRequestRelease = createDeferred<void>();
    const callSequence: string[] = [];
    let callCount = 0;

    const service = new SetConfigOptionService(
      sessionRuntime,
      createGateway({
        session,
        setSessionConfigOption: async (_session, configId, value) => {
          callCount += 1;
          callSequence.push(`${configId}:${value}:start`);
          if (callCount === 1) {
            await firstRequestRelease.promise;
            callSequence.push(`${configId}:${value}:end`);
            return [
              createSelectOption({
                id: "mode",
                name: "Mode",
                category: "mode",
                currentValue: "architect",
                values: ["code", "architect"],
              }),
              createSelectOption({
                id: "reasoning",
                name: "Reasoning",
                category: "thought_level",
                currentValue: "low",
                values: ["low", "high"],
              }),
            ];
          }
          callSequence.push(`${configId}:${value}:end`);
          return [
            createSelectOption({
              id: "mode",
              name: "Mode",
              category: "mode",
              currentValue: "architect",
              values: ["code", "architect"],
            }),
            createSelectOption({
              id: "reasoning",
              name: "Reasoning",
              category: "thought_level",
              currentValue: "high",
              values: ["low", "high"],
            }),
          ];
        },
      })
    );

    const first = service.execute("user-1", "chat-1", "mode", "architect");
    await flushAsync();
    const second = service.execute("user-1", "chat-1", "reasoning", "high");
    await flushAsync();

    expect(callCount).toBe(1);
    expect(callSequence).toEqual(["mode:architect:start"]);

    firstRequestRelease.resolve();
    const [, secondResult] = await Promise.all([first, second]);

    expect(callCount).toBe(2);
    expect(callSequence).toEqual([
      "mode:architect:start",
      "mode:architect:end",
      "reasoning:high:start",
      "reasoning:high:end",
    ]);
    expect(
      secondResult.configOptions.find((option) => option.id === "reasoning")
        ?.currentValue
    ).toBe("high");
    expect(
      session.configOptions?.find((option) => option.id === "reasoning")
        ?.currentValue
    ).toBe("high");
  });
});
