import { describe, expect, test } from "bun:test";
import type {
  CodingPlanSubscriptionNotifier,
  CodingPlanSubscriptionUpdateNotification,
} from "./coding-plan-subscription.notifier";
import { CodingPlanSubscriptionService } from "./coding-plan-subscription.service";
import type { CodingPlanSubscriptionState } from "./contracts/coding-plan-subscription.contract";
import type { CodingPlanBillingPort } from "./ports/coding-plan-billing.port";
import type {
  CodingPlanSubscriptionRepositoryPort,
  CodingPlanSubscriptionStoreSnapshot,
  MutableCodingPlanSubscriptionStoreSnapshot,
} from "./ports/coding-plan-subscription-repository.port";

class InMemorySubscriptionRepo implements CodingPlanSubscriptionRepositoryPort {
  snapshot: MutableCodingPlanSubscriptionStoreSnapshot = {
    subscriptionsByUserId: {},
  };

  constructor(state?: CodingPlanSubscriptionState) {
    if (state) {
      this.snapshot.subscriptionsByUserId[state.userId] = state;
    }
  }

  async read<T>(
    reader: (snapshot: CodingPlanSubscriptionStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(this.snapshot);
  }

  async mutate<T>(
    mutator: (
      snapshot: MutableCodingPlanSubscriptionStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
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

function createCodingPlanSubscriptionNotifierStub(
  calls: CodingPlanSubscriptionUpdateNotification[] = []
) {
  return {
    subscriptionUpdated(input) {
      calls.push(input);
      return Promise.resolve();
    },
  } satisfies CodingPlanSubscriptionNotifier;
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

  test("updates subscription and reports a subscription-updated notification", async () => {
    const notifications: CodingPlanSubscriptionUpdateNotification[] = [];
    const repository = new InMemorySubscriptionRepo();
    const service = new CodingPlanSubscriptionService({
      repository,
      billing: new BillingStub(),
      notifier: createCodingPlanSubscriptionNotifierStub(notifications),
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
    expect(notifications).toEqual([
      {
        previous: {
          userId: "user-1",
          tier: "free",
          status: "none",
          billingProvider: "local",
          planId: "free",
          updatedAt: 2,
          entitlements: [],
        },
        next: {
          userId: "user-1",
          tier: "pro",
          status: "active",
          billingProvider: "local",
          planId: "free",
          updatedAt: 2,
          entitlements: [],
        },
        source: "local",
      },
    ]);
    expect(repository.snapshot.subscriptionsByUserId["user-1"]).toMatchObject({
      tier: "pro",
      status: "active",
      updatedAt: 2,
    });
  });

  test("syncs external billing snapshots through the billing port", async () => {
    const billing = new BillingStub();
    const notifications: CodingPlanSubscriptionUpdateNotification[] = [];
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
      notifier: createCodingPlanSubscriptionNotifierStub(notifications),
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
    expect(notifications).toMatchObject([
      {
        source: "billing_sync",
        previous: {
          tier: "free",
          status: "none",
        },
        next: {
          tier: "team",
          status: "active",
        },
      },
    ]);
  });
});
