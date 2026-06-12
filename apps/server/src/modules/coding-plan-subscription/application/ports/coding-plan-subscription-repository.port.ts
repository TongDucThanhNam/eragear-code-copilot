import type { CodingPlanSubscriptionState } from "../contracts/coding-plan-subscription.contract";

export interface CodingPlanSubscriptionRepositoryPort {
  getSubscription(userId: string): Promise<CodingPlanSubscriptionState | null>;
  saveSubscription(
    subscription: CodingPlanSubscriptionState
  ): Promise<CodingPlanSubscriptionState>;
}
