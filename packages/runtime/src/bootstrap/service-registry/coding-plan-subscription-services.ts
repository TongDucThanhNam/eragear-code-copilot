import {
  CodingPlanSubscriptionFileRepository,
  CodingPlanSubscriptionService,
  createEventBusCodingPlanSubscriptionNotifier,
  LocalCodingPlanBillingAdapter,
} from "#runtime/modules/coding-plan-subscription";
import type { CodingPlanSubscriptionUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type CodingPlanSubscriptionServiceDependencies = ServiceRegistrySlice<
  "eventBus" | "clock"
>;

export function createCodingPlanSubscriptionUseCases(
  deps: CodingPlanSubscriptionServiceDependencies
): CodingPlanSubscriptionUseCases {
  return {
    codingPlanSubscription: new CodingPlanSubscriptionService({
      repository: new CodingPlanSubscriptionFileRepository({
        filePath: () => getStorageFileSync("coding-plan-subscription.json"),
      }),
      billing: new LocalCodingPlanBillingAdapter(),
      notifier: createEventBusCodingPlanSubscriptionNotifier(deps.eventBus),
      nowMs: deps.clock.nowMs,
    }),
  };
}
