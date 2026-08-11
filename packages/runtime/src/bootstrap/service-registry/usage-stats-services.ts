import { QuotaCycleUsageService } from "#runtime/modules/quota";
import {
  CachedUsageStatsScannerAdapter,
  LocalCliUsageScannerAdapter,
  UsageStatsService,
} from "#runtime/modules/usage-stats";
import type {
  QuotaUseCases,
  UsageStatsUseCases,
} from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type UsageStatsServiceDependencies = ServiceRegistrySlice<
  "usageStatsRepo" | "clock"
>;

export function createUsageStatsUseCases(
  deps: UsageStatsServiceDependencies,
  quotaProvider: QuotaUseCases["provider"]
): UsageStatsUseCases {
  const scanner = new CachedUsageStatsScannerAdapter(
    new LocalCliUsageScannerAdapter()
  );
  return {
    usageStats: new UsageStatsService({
      repository: deps.usageStatsRepo,
      scanner,
      nowMs: deps.clock.nowMs,
    }),
    quotaCycles: new QuotaCycleUsageService({
      repository: deps.usageStatsRepo,
      scanner,
      quotaProvider,
      nowMs: deps.clock.nowMs,
    }),
  };
}
