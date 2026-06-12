import {
  CodingPlanSubscriptionFileRepository,
  CodingPlanSubscriptionService,
  LocalCodingPlanBillingAdapter,
} from "@/modules/coding-plan-subscription";
import type { CodingPlanSubscriptionUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createCodingPlanSubscriptionUseCases(
  deps: ServiceRegistryDependencies
): CodingPlanSubscriptionUseCases {
  return {
    codingPlanSubscription: new CodingPlanSubscriptionService({
      repository: new CodingPlanSubscriptionFileRepository({
        filePath: () => getStorageFileSync("coding-plan-subscription.json"),
      }),
      billing: new LocalCodingPlanBillingAdapter(),
      eventBus: deps.eventBus,
      nowMs: deps.clock.nowMs,
    }),
  };
}
