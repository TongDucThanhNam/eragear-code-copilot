import {
  UsageStatsFileRepository,
  UsageStatsService,
} from "@/modules/usage-stats";
import type { UsageStatsUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createUsageStatsUseCases(
  deps: ServiceRegistryDependencies
): UsageStatsUseCases {
  return {
    usageStats: new UsageStatsService({
      repository: new UsageStatsFileRepository({
        filePath: () => getStorageFileSync("usage-stats.json"),
      }),
      nowMs: deps.clock.nowMs,
    }),
  };
}
