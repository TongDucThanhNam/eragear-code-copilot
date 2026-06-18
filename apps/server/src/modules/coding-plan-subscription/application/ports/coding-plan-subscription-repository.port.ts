import type { CodingPlanSubscriptionState } from "../contracts/coding-plan-subscription.contract";

export interface CodingPlanSubscriptionRepositoryPort {
  read<T>(
    reader: (snapshot: CodingPlanSubscriptionStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (
      snapshot: MutableCodingPlanSubscriptionStoreSnapshot
    ) => T | Promise<T>
  ): Promise<T>;
}

export interface CodingPlanSubscriptionStoreSnapshot {
  subscriptionsByUserId: Readonly<Record<string, CodingPlanSubscriptionState>>;
}

export interface MutableCodingPlanSubscriptionStoreSnapshot {
  subscriptionsByUserId: Record<string, CodingPlanSubscriptionState>;
}
