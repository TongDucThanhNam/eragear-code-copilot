/**
 * Cache Prune Task
 *
 * Prunes expired response cache entries.
 *
 * @module infra/background/tasks/cache-prune.task
 */

import { ENV } from "#runtime/config/environment";
import { getResponseCache } from "#runtime/platform/caching/response-cache";
import type { BackgroundTaskSpec } from "#runtime/shared/types/background.types";

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
