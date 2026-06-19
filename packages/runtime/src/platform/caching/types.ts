/**
 * Cache Entry
 *
 * Represents a single cache entry with metadata.
 *
 * @module infra/caching/types
 */

/**
 * Generic cache entry
 */
export interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Creation timestamp */
  createdAt: number;
  /** Expiration timestamp */
  expiresAt: number;
  /** Number of times accessed */
  hits: number;
}

/**
 * Cache options
 */
export interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttl?: number;
  /** Tag for grouping related cache entries */
  tag?: string;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total entries in cache */
  size: number;
  /** Total hits */
  hits: number;
  /** Total misses */
  misses: number;
  /** Hit ratio (0-1) */
  hitRatio: number;
  /** Memory usage estimate (bytes) */
  memoryUsage: number;
}
