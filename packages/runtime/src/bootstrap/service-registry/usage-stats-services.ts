import { QuotaCycleUsageService } from "#runtime/modules/quota";
import {
  CachedUsageStatsScannerAdapter,
  UsageStatsService,
  UsageStatsSnapshotSqliteCache,
  WorkerUsageStatsScannerAdapter,
} from "#runtime/modules/usage-stats";
import type {
  QuotaUseCases,
  UsageStatsUseCases,
} from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type UsageStatsServiceDependencies = ServiceRegistrySlice<
  "usageStatsRepo" | "clock"
>;

export function createUsageStatsUseCases(
  deps: UsageStatsServiceDependencies,
  quotaProvider: QuotaUseCases["provider"]
): UsageStatsUseCases {
  const scanner = new CachedUsageStatsScannerAdapter(
    new WorkerUsageStatsScannerAdapter(),
    {
      snapshotCache: new UsageStatsSnapshotSqliteCache({
        filePath: () => getStorageFileSync("usage-stats-snapshots.sqlite"),
      }),
    }
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
