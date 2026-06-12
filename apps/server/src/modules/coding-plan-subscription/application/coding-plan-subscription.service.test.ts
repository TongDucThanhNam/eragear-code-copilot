import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { CodingPlanSubscriptionService } from "./coding-plan-subscription.service";
import type { CodingPlanSubscriptionState } from "./contracts/coding-plan-subscription.contract";
import type { CodingPlanBillingPort } from "./ports/coding-plan-billing.port";
import type { CodingPlanSubscriptionRepositoryPort } from "./ports/coding-plan-subscription-repository.port";

class InMemorySubscriptionRepo implements CodingPlanSubscriptionRepositoryPort {
  state: CodingPlanSubscriptionState | null = null;

  getSubscription(
    _userId: string
  ): Promise<CodingPlanSubscriptionState | null> {
    return Promise.resolve(this.state);
  }

  saveSubscription(
    subscription: CodingPlanSubscriptionState
  ): Promise<CodingPlanSubscriptionState> {
    this.state = subscription;
    return Promise.resolve(subscription);
  }
}

class BillingStub implements CodingPlanBillingPort {
  snapshot: Awaited<ReturnType<CodingPlanBillingPort["pullSubscription"]>> =
    null;

  pullSubscription(): Promise<
    Awaited<ReturnType<CodingPlanBillingPort["pullSubscription"]>>
  > {
    return Promise.resolve(this.snapshot);
  }

  createPortalSession(): Promise<{ available: boolean; reason: string }> {
    return Promise.resolve({
      available: false,
      reason: "not configured",
    });
  }
}

describe("CodingPlanSubscriptionService", () => {
  test("returns default free gates without persisted state", async () => {
    const service = new CodingPlanSubscriptionService({
      repository: new InMemorySubscriptionRepo(),
      billing: new BillingStub(),
      nowMs: () => 1,
    });

    const status = await service.getStatus("user-1");

    expect(status.subscription.tier).toBe("free");
    expect(
      status.featureGates.find((gate) => gate.featureId === "basic_chat")
        ?.enabled
    ).toBe(true);
    expect(
      status.featureGates.find((gate) => gate.featureId === "task_queue")
        ?.enabled
    ).toBe(false);
  });

  test("updates subscription and publishes a domain event", async () => {
    const events: DomainEvent[] = [];
    const eventBus: EventBusPort = {
      subscribe: () => () => undefined,
      publish: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
    const service = new CodingPlanSubscriptionService({
      repository: new InMemorySubscriptionRepo(),
      billing: new BillingStub(),
      eventBus,
      nowMs: () => 2,
    });

    const status = await service.updateSubscription("user-1", {
      tier: "pro",
      status: "active",
    });

    expect(status.subscription.tier).toBe("pro");
    expect(
      status.featureGates.find((gate) => gate.featureId === "task_queue")
        ?.enabled
    ).toBe(true);
    expect(events).toContainEqual({
      type: "coding_plan_subscription_updated",
      userId: "user-1",
      tier: "pro",
      previousTier: "free",
      status: "active",
      previousStatus: "none",
      source: "local",
      updatedAt: new Date(2).toISOString(),
      changed: true,
    });
  });

  test("syncs external billing snapshots through the billing port", async () => {
    const billing = new BillingStub();
    billing.snapshot = {
      tier: "team",
      status: "active",
      billingProvider: "external",
      planId: "team-monthly",
      externalCustomerId: "cus_1",
      externalSubscriptionId: "sub_1",
      entitlements: [],
    };
    const service = new CodingPlanSubscriptionService({
      repository: new InMemorySubscriptionRepo(),
      billing,
      nowMs: () => 3,
    });

    const result = await service.syncBilling("user-1");

    expect(result.billing).toMatchObject({
      attempted: true,
      available: true,
      changed: true,
    });
    expect(result.status.subscription.tier).toBe("team");
    expect(
      result.status.featureGates.find((gate) => gate.featureId === "plugins")
        ?.enabled
    ).toBe(true);
  });
});
