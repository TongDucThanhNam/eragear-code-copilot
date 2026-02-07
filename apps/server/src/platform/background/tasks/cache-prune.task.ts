/**
 * Cache Prune Task
 *
 * Prunes expired response cache entries.
 *
 * @module infra/background/tasks/cache-prune.task
 */

import { ENV } from "@/config/environment";
import { getResponseCache } from "@/platform/caching/response-cache";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";

export function createCachePruneTask(): BackgroundTaskSpec {
  return {
    name: "cache-prune",
    intervalMs: ENV.backgroundCachePruneIntervalMs,
    run: () => {
      const removed = getResponseCache().prune();
      return { removed };
    },
  };
}
