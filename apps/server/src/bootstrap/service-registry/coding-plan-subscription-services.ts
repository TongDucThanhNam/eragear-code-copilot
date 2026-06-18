import {
  CodingPlanSubscriptionFileRepository,
  CodingPlanSubscriptionService,
  createEventBusCodingPlanSubscriptionNotifier,
  LocalCodingPlanBillingAdapter,
} from "@/modules/coding-plan-subscription";
import type { CodingPlanSubscriptionUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
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
