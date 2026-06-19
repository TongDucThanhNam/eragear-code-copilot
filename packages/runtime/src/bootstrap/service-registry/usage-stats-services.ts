import {
  LocalCliUsageScannerAdapter,
  UsageStatsService,
} from "#runtime/modules/usage-stats";
import type { UsageStatsUseCases } from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type UsageStatsServiceDependencies = ServiceRegistrySlice<
  "usageStatsRepo" | "clock"
>;

export function createUsageStatsUseCases(
  deps: UsageStatsServiceDependencies
): UsageStatsUseCases {
  return {
    usageStats: new UsageStatsService({
      repository: deps.usageStatsRepo,
      scanner: new LocalCliUsageScannerAdapter(),
      nowMs: deps.clock.nowMs,
    }),
  };
}
