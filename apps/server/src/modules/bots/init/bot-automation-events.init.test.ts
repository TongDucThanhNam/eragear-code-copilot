import { describe, expect, test } from "bun:test";
import type { BotsUseCases } from "@/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { initializeBotAutomationEvents } from "./bot-automation-events.init";

function createEventBusStub() {
  let listener: EventBusListener | undefined;
  const eventBus: EventBusPort = {
    subscribe: (nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    publish: () => Promise.resolve(),
  };
  return {
    eventBus,
    dispatch: async (event: Parameters<EventBusListener>[0]) => {
      await listener?.(event, { signal: new AbortController().signal });
    },
  };
}

function createLogger(): LoggerPort {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

describe("initializeBotAutomationEvents", () => {
  test("routes quota and lifecycle events to bot automation use cases", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { dispatch, eventBus } = createEventBusStub();
    const botsUseCases = {
      bots: {
        recordQuotaSnapshot: (input: unknown) => {
          calls.push({ name: "quota", input });
          return Promise.resolve();
        },
        completeRunsForTurn: (input: unknown) => {
          calls.push({ name: "complete", input });
          return Promise.resolve();
        },
        stopRunsForSession: (input: unknown) => {
          calls.push({ name: "stop", input });
          return Promise.resolve();
        },
      },
    } as unknown as BotsUseCases;

    initializeBotAutomationEvents({
      eventBus,
      botsUseCases,
      logger: createLogger(),
    });

    await dispatch({
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai Coding Plan",
      status: "ready",
      fetchedAt: "2026-06-12T12:00:00.000Z",
      windows: [
        {
          id: "5h",
          windowType: "rolling",
          label: "5h",
          percentRemaining: 10,
          used: 90,
          total: 100,
          remaining: 10,
          resetAt: "2026-06-12T17:00:00.000Z",
          scope: "coding",
        },
      ],
      changed: true,
    });
    await dispatch({
      type: "prompt_turn_completed",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      source: "client",
    });
    await dispatch({
      type: "agent_session_stopped",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      stopReason: "manual",
    });

    expect(calls).toEqual([
      {
        name: "quota",
        input: {
          userId: "user-1",
          providerId: "zai",
          providerDisplayName: "Z.ai Coding Plan",
          status: "ready",
          windows: [
            {
              id: "5h",
              windowType: "rolling",
              label: "5h",
              percentRemaining: 10,
              remaining: 10,
              resetAt: "2026-06-12T17:00:00.000Z",
            },
          ],
        },
      },
      {
        name: "complete",
        input: {
          userId: "user-1",
          chatId: "chat-1",
          turnId: "turn-1",
          stopReason: "end_turn",
        },
      },
      {
        name: "stop",
        input: {
          userId: "user-1",
          chatId: "chat-1",
          stopReason: "manual",
        },
      },
    ]);
  });
});
