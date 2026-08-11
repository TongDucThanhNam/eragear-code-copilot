import { describe, expect, test } from "bun:test";
import type { UsageStatsUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeUsageStatsEvents } from "./usage-stats-events.init";

function createEventBusStub() {
  let listener: EventBusListener | undefined;
  const eventBus: EventBusPort = {
    subscribe(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    publish() {
      return Promise.resolve();
    },
  };
  return {
    eventBus,
    dispatch(event: DomainEvent) {
      return listener?.(event, { signal: new AbortController().signal });
    },
  };
}

describe("initializeUsageStatsEvents", () => {
  test("records lifecycle and quota events asynchronously", async () => {
    const calls: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const usageStatsUseCases = {
      usageStats: {
        recordLifecycleUsage(input: unknown) {
          calls.push(["lifecycle", input]);
          return Promise.resolve();
        },
        recordQuotaRefresh(input: unknown) {
          calls.push(["quota", input]);
          return Promise.resolve();
        },
      },
    } as unknown as UsageStatsUseCases;

    initializeUsageStatsEvents({
      eventBus,
      usageStatsUseCases,
      logger: { warn: () => undefined } as never,
    });
    dispatch({
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      source: "client",
    });
    dispatch({
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai Coding Plan",
      status: "ready",
      fetchedAt: "2026-06-12T12:00:00.000Z",
      windows: [],
      changed: true,
    });
    expect(calls).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([
      [
        "lifecycle",
        {
          kind: "prompt_sent",
          userId: "user-1",
          projectRoot: "/repo",
          chatId: "chat-1",
          turnId: "turn-1",
        },
      ],
      [
        "quota",
        {
          userId: "user-1",
          providerId: "zai",
          providerDisplayName: "Z.ai Coding Plan",
          status: "ready",
          fetchedAt: "2026-06-12T12:00:00.000Z",
          windows: [],
        },
      ],
    ]);
  });
});
