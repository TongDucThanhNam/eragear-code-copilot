import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import type { ProviderQuotaSnapshot } from "./contracts/quota.contract";
import { createEventBusProviderQuotaNotifier } from "./provider-quota.notifier";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

function createSnapshot(
  overrides: Partial<ProviderQuotaSnapshot> = {}
): ProviderQuotaSnapshot {
  return {
    providerId: "openai",
    displayName: "OpenAI",
    aliases: ["codex"],
    source: "remote_api",
    status: "ready",
    attempted: true,
    checkedAt: "2026-06-12T12:00:00.000Z",
    fetchedAt: "2026-06-12T12:00:01.000Z",
    windows: [
      {
        id: "primary",
        label: "Primary",
        percentRemaining: 42,
        resetAt: "2026-06-12T13:00:00.000Z",
      },
      {
        id: "daily",
        label: "Daily",
        percentRemaining: 64,
        resetAt: "2026-06-13T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ProviderQuotaNotifier", () => {
  test("publishes provider quota refresh events with derived fields", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusProviderQuotaNotifier(
      createEventBusStub(events)
    );

    await notifier.providerQuotaRefreshed({
      userId: "user-1",
      snapshot: createSnapshot(),
      nowMs: NOW_MS,
    });

    expect(events).toEqual([
      {
        type: "provider_quota_refreshed",
        userId: "user-1",
        providerId: "openai",
        providerDisplayName: "OpenAI",
        status: "ready",
        previousStatus: undefined,
        fetchedAt: "2026-06-12T12:00:01.000Z",
        windows: [
          {
            id: "primary",
            label: "Primary",
            percentRemaining: 42,
            resetAt: "2026-06-12T13:00:00.000Z",
          },
          {
            id: "daily",
            label: "Daily",
            percentRemaining: 64,
            resetAt: "2026-06-13T00:00:00.000Z",
          },
        ],
        minPercentRemaining: 42,
        nextResetAt: "2026-06-12T13:00:00.000Z",
        changed: true,
      },
    ]);
  });

  test("marks unchanged snapshots when status, error, and windows match", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusProviderQuotaNotifier(
      createEventBusStub(events)
    );
    const previous = createSnapshot({
      fetchedAt: "2026-06-12T11:59:00.000Z",
    });

    await notifier.providerQuotaRefreshed({
      userId: "user-1",
      snapshot: createSnapshot(),
      previous,
      nowMs: NOW_MS,
    });

    expect(events[0]).toMatchObject({
      type: "provider_quota_refreshed",
      previousStatus: "ready",
      changed: false,
    });
  });

  test("does not publish unavailable provider snapshots", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusProviderQuotaNotifier(
      createEventBusStub(events)
    );

    await notifier.providerQuotaRefreshed({
      userId: "user-1",
      snapshot: createSnapshot({
        status: "unavailable",
        attempted: false,
        windows: [],
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Provider unavailable.",
        },
      }),
      nowMs: NOW_MS,
    });

    expect(events).toEqual([]);
  });
});
