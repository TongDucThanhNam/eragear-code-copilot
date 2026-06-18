import {
  LocalCliUsageScannerAdapter,
  UsageStatsService,
} from "@/modules/usage-stats";
import type { UsageStatsUseCases } from "@/modules/use-cases";
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
