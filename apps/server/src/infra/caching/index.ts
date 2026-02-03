/**
 * Caching Module
 *
 * Response caching infrastructure with TTL support.
 *
 * @module infra/caching
 */

export { ResponseCache, getResponseCache } from "./response-cache";
export type { CacheEntry, CacheOptions, CacheStats } from "./types";
export { createCacheMiddleware, clearCacheByTag, getCacheStats } from "./middleware";
