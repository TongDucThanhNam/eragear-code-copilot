/**
 * Caching Module
 *
 * Response caching infrastructure with TTL support.
 *
 * @module infra/caching
 */

/* biome-ignore lint/performance/noBarrelFile: module entrypoint intentionally re-exports cache utilities. */
export {
  clearCacheByTag,
  createCacheMiddleware,
  getCacheStats,
} from "./middleware";
export { getResponseCache, ResponseCache } from "./response-cache";
export type { CacheEntry, CacheOptions, CacheStats } from "./types";
