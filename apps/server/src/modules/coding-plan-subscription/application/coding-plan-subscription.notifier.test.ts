import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import {
  createEventBusCodingPlanSubscriptionNotifier,
  hasSubscriptionChanged,
} from "./coding-plan-subscription.notifier";
import type { CodingPlanSubscriptionState } from "./contracts/coding-plan-subscription.contract";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

function createSubscription(
  overrides: Partial<CodingPlanSubscriptionState> = {}
): CodingPlanSubscriptionState {
  return {
    userId: "user-1",
    tier: "free",
    status: "none",
    billingProvider: "local",
    planId: "free",
    updatedAt: 1,
    entitlements: [],
    ...overrides,
  };
}

describe("CodingPlanSubscriptionNotifier", () => {
  test("publishes coding plan subscription updated events", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusCodingPlanSubscriptionNotifier(
      createEventBusStub(events)
    );

    await notifier.subscriptionUpdated({
      previous: createSubscription(),
      next: createSubscription({
        tier: "pro",
        status: "active",
        planId: "pro",
        updatedAt: 2,
      }),
      source: "local",
    });

    expect(events).toEqual([
      {
        type: "coding_plan_subscription_updated",
        userId: "user-1",
        tier: "pro",
        previousTier: "free",
        status: "active",
        previousStatus: "none",
        source: "local",
        updatedAt: new Date(2).toISOString(),
        changed: true,
      },
    ]);
  });

  test("ignores updatedAt when determining semantic changes", () => {
    expect(
      hasSubscriptionChanged(
        createSubscription({ updatedAt: 1 }),
        createSubscription({ updatedAt: 2 })
      )
    ).toBe(false);
  });
});
