import type {
  CodingPlanBillingPortalResult,
  OpenBillingPortalInput,
} from "../application/contracts/coding-plan-subscription.contract";
import type {
  CodingPlanBillingPort,
  CodingPlanBillingSnapshot,
} from "../application/ports/coding-plan-billing.port";

export class LocalCodingPlanBillingAdapter implements CodingPlanBillingPort {
  pullSubscription(_userId: string): Promise<CodingPlanBillingSnapshot | null> {
    return Promise.resolve(null);
  }

  createPortalSession(
    _userId: string,
    _input?: OpenBillingPortalInput
  ): Promise<CodingPlanBillingPortalResult> {
    return Promise.resolve({
      available: false,
      reason: "No billing provider is configured.",
    });
  }
}
