import { ContextUsageService } from "@/modules/context-usage";
import { LocalContextUsageEstimatorAdapter } from "@/modules/context-usage/di";
import type { ContextUsageUseCases, UseCasePort } from "@/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type ContextUsageServiceDependencies = ServiceRegistrySlice<
  "sessionRepo" | "sessionRuntime" | "clock"
>;

export function createContextUsageUseCases(
  deps: ContextUsageServiceDependencies
): ContextUsageUseCases {
  return {
    contextUsage: new ContextUsageService({
      sessionRepo: deps.sessionRepo,
      sessionRuntime: deps.sessionRuntime,
      estimator: new LocalContextUsageEstimatorAdapter(),
      nowMs: () => deps.clock.nowMs(),
    }) as UseCasePort<ContextUsageService>,
  };
}
