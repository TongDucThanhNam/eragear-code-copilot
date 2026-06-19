import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { CodingPlanSubscriptionState } from "./contracts/coding-plan-subscription.contract";

export type CodingPlanSubscriptionUpdateSource = "local" | "billing_sync";

export interface CodingPlanSubscriptionUpdateNotification {
  previous: CodingPlanSubscriptionState;
  next: CodingPlanSubscriptionState;
  source: CodingPlanSubscriptionUpdateSource;
}

export interface CodingPlanSubscriptionNotifier {
  subscriptionUpdated(
    input: CodingPlanSubscriptionUpdateNotification
  ): Promise<void>;
}

export function createEventBusCodingPlanSubscriptionNotifier(
  eventBus: EventBusPort
): CodingPlanSubscriptionNotifier {
  return {
    async subscriptionUpdated(input) {
      await eventBus.publish({
        type: "coding_plan_subscription_updated",
        userId: input.next.userId,
        tier: input.next.tier,
        previousTier: input.previous.tier,
        status: input.next.status,
        previousStatus: input.previous.status,
        source: input.source,
        updatedAt: new Date(input.next.updatedAt).toISOString(),
        changed: hasSubscriptionChanged(input.previous, input.next),
      });
    },
  };
}

export const noopCodingPlanSubscriptionNotifier: CodingPlanSubscriptionNotifier =
  {
    subscriptionUpdated: () => Promise.resolve(),
  };

export function hasSubscriptionChanged(
  previous: CodingPlanSubscriptionState,
  next: CodingPlanSubscriptionState
): boolean {
  return (
    JSON.stringify(normalizeForComparison(previous)) !==
    JSON.stringify(normalizeForComparison(next))
  );
}

function normalizeForComparison(
  subscription: CodingPlanSubscriptionState
): Omit<CodingPlanSubscriptionState, "updatedAt"> {
  const { updatedAt: _updatedAt, ...rest } = subscription;
  return rest;
}
