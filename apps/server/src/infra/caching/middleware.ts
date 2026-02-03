/**
 * Cache Middleware
 *
 * Middleware for caching route responses based on cache keys.
 *
 * @module infra/caching/middleware
 */

import type { MiddlewareHandler } from "hono";
import { getResponseCache } from "./response-cache";
import type { CacheOptions } from "./types";

/**
 * Creates a middleware that caches responses based on request
 *
 * @param keyFn - Function to generate cache key from context
 * @param options - Cache options
 * @returns Middleware handler
 *
 * @example
 * ```typescript
 * const cacheDashboard = createCacheMiddleware(
 *   (c) => "dashboard",
 *   { ttl: 60000 }
 * );
 * app.get("/api/dashboard", cacheDashboard, getDashboardHandler);
 * ```
 */
export function createCacheMiddleware(
  keyFn: (context: any) => string,
  options: CacheOptions = {}
): MiddlewareHandler {
  return async (c, next) => {
    const cache = getResponseCache();
    const key = keyFn(c);

    // Try to get from cache
    const cached = cache.get(key);
    if (cached) {
      c.res.headers.set("X-Cache", "HIT");
      return c.json(cached);
    }

    c.res.headers.set("X-Cache", "MISS");

    // Process request and cache response
    await next();

    // Only cache successful responses
    if (c.res.status === 200) {
      try {
        const data = await c.res.clone().json();
        cache.set(key, data, options);
      } catch {
        // Skip caching if response is not JSON
      }
    }
  };
}

/**
 * Clear cache entries by tag
 *
 * Note: Simple implementation - in production, track tags separately
 */
export function clearCacheByTag(): void {
  const cache = getResponseCache();
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const cache = getResponseCache();
  return cache.getStats();
}
