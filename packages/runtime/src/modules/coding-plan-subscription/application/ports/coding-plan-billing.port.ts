import type {
  CodingPlanBillingPortalResult,
  CodingPlanSubscriptionState,
  OpenBillingPortalInput,
} from "../contracts/coding-plan-subscription.contract";

export type CodingPlanBillingSnapshot = Omit<
  CodingPlanSubscriptionState,
  "userId" | "updatedAt"
>;

export interface CodingPlanBillingPort {
  pullSubscription(userId: string): Promise<CodingPlanBillingSnapshot | null>;
  createPortalSession(
    userId: string,
    input?: OpenBillingPortalInput
  ): Promise<CodingPlanBillingPortalResult>;
}
