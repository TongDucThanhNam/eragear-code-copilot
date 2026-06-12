import { ContextUsageService } from "@/modules/context-usage";
import { LocalContextUsageEstimatorAdapter } from "@/modules/context-usage/di";
import type { ContextUsageUseCases, UseCasePort } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createContextUsageUseCases(
  deps: ServiceRegistryDependencies
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
