/**
 * Response Cache Store
 *
 * In-memory cache with TTL support for caching computed responses.
 * Useful for expensive operations like dashboard data aggregation.
 *
 * @module infra/caching/response-cache
 */

import { createLogger } from "../logging/structured-logger";
import type { CacheEntry, CacheOptions, CacheStats } from "./types";

const logger = createLogger("Server");

const DEFAULT_TTL = 60 * 1000; // 1 minute default

/**
 * In-memory response cache with TTL and statistics
 *
 * @example
 * ```typescript
 * const cache = new ResponseCache();
 *
 * // Cache dashboard data for 1 minute
 * const data = await cache.getOrCompute(
 *   "dashboard",
 *   () => buildDashboardData(...),
 *   { ttl: 60000 }
 * );
 *
 * // Get stats
 * const stats = cache.getStats();
 * console.log(`Cache hit ratio: ${stats.hitRatio.toFixed(2)}%`);
 * ```
 */
export class ResponseCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  /**
   * Get cached value or compute and cache new value
   *
   * @param key - Cache key
   * @param compute - Async function to compute value if not cached
   * @param options - Cache options (ttl, tag)
   * @returns Cached or computed value
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { ttl = DEFAULT_TTL } = options;

    // Check cache first
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      cached.hits++;
      this.hits++;
      logger.debug("Cache hit", { key, hits: cached.hits });
      return cached.value as T;
    }

    // Compute new value
    logger.debug("Cache miss, computing", { key });
    this.misses++;

    try {
      const value = await compute();

      // Store in cache
      this.store.set(key, {
        value,
        createdAt: Date.now(),
        expiresAt: Date.now() + ttl,
        hits: 0,
      });

      logger.debug("Cache stored", { key, ttl });
      return value;
    } catch (err) {
      logger.error("Cache compute error", err as Error, { key });
      throw err;
    }
  }

  /**
   * Get cached value without computing
   *
   * @param key - Cache key
   * @returns Cached value or undefined if not found or expired
   */
  get<T>(key: string): T | undefined {
    const cached = this.store.get(key);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    cached.hits++;
    this.hits++;
    return cached.value as T;
  }

  /**
   * Set cache value directly
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Cache options
   */
  set<T>(key: string, value: T, options: CacheOptions = {}): void {
    const { ttl = DEFAULT_TTL } = options;

    this.store.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      hits: 0,
    });

    logger.debug("Cache set", { key, ttl });
  }

  /**
   * Delete cache entry
   *
   * @param key - Cache key
   */
  delete(key: string): void {
    const deleted = this.store.delete(key);
    if (deleted) {
      logger.debug("Cache deleted", { key });
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.store.size;
    this.store.clear();
    logger.info("Cache cleared", { entries: size });
  }

  /**
   * Clear expired entries
   *
   * @returns Number of entries removed
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug("Cache pruned", { removed });
    }

    return removed;
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats object
   */
  getStats(): CacheStats {
    this.prune();

    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? (this.hits / total) * 100 : 0;

    // Estimate memory usage (rough estimate)
    let memoryUsage = 0;
    for (const entry of this.store.values()) {
      memoryUsage += JSON.stringify(entry.value).length * 2; // Rough estimate
    }

    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
      memoryUsage,
    };
  }

  /**
   * Enable automatic cache cleanup on interval
   *
   * @param interval - Interval in milliseconds (default 5 minutes)
   * @returns Function to stop cleanup
   */
  enableAutoCleanup(interval: number = 5 * 60 * 1000): () => void {
    const timer = setInterval(() => {
      this.prune();
    }, interval);

    return () => clearInterval(timer);
  }
}

/**
 * Global response cache instance
 *
 * Singleton cache for application-wide use.
 */
let globalCache: ResponseCache | null = null;

/**
 * Get global cache instance
 *
 * @returns Global ResponseCache instance
 */
export function getResponseCache(): ResponseCache {
  if (!globalCache) {
    globalCache = new ResponseCache();
    globalCache.enableAutoCleanup();
    logger.info("Response cache initialized");
  }
  return globalCache;
}
