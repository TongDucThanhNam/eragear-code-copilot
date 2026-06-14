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
    const calls: string[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const botsUseCases = {
      bots: {
        recordQuotaSnapshot: () => {
          calls.push("quota");
          return Promise.resolve();
        },
        completeRunsForTurn: () => {
          calls.push("complete");
          return Promise.resolve();
        },
        stopRunsForSession: () => {
          calls.push("stop");
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
      windows: [],
      changed: true,
    });
    await dispatch({
      type: "local_ade_lifecycle",
      event: "after-agent-turn-complete",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
    });
    await dispatch({
      type: "local_ade_lifecycle",
      event: "after-agent-session-stop",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      stopReason: "manual",
    });

    expect(calls).toEqual(["quota", "complete", "stop"]);
  });
});
