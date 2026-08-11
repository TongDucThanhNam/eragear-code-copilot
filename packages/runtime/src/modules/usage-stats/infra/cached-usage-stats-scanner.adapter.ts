import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";

const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 64;
const CACHE_END_BUCKET_MS = 15 * 1000;

interface CachedScanEntry {
  expiresAtMs: number;
  result: UsageStatsCliSummary;
}

export class CachedUsageStatsScannerAdapter implements UsageStatsScannerPort {
  private readonly delegate: UsageStatsScannerPort;
  private readonly cacheTtlMs: number;
  private readonly maxEntries: number;
  private readonly nowMs: () => number;
  private readonly cache = new Map<string, CachedScanEntry>();
  private readonly inFlight = new Map<string, Promise<UsageStatsCliSummary>>();

  constructor(
    delegate: UsageStatsScannerPort,
    options: {
      cacheTtlMs?: number;
      maxEntries?: number;
      nowMs?: () => number;
    } = {}
  ) {
    this.delegate = delegate;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.nowMs = options.nowMs ?? Date.now;
  }

  scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    const key = createCacheKey(input);
    const nowMs = this.nowMs();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      this.touch(key, cached);
      return Promise.resolve(cached.result);
    }
    if (cached) {
      this.cache.delete(key);
    }

    const active = this.inFlight.get(key);
    if (active) {
      return active;
    }

    const operation = this.delegate
      .scan(input)
      .then((result) => {
        this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, operation);
    return operation;
  }

  clear(): void {
    this.cache.clear();
  }

  private store(key: string, result: UsageStatsCliSummary): void {
    if (this.cacheTtlMs <= 0) {
      return;
    }
    this.cache.delete(key);
    this.cache.set(key, {
      expiresAtMs: this.nowMs() + this.cacheTtlMs,
      result,
    });
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }

  private touch(key: string, entry: CachedScanEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
  }
}

function createCacheKey(input: UsageStatsScannerInput): string {
  const providers = input.providers?.length
    ? [...new Set(input.providers)].sort().join(",")
    : "*";
  const rangeIdentity =
    input.range === "all" ? `start:${input.startMs ?? 0}` : input.range;
  const endBucket = Math.floor(input.endMs / CACHE_END_BUCKET_MS);
  return `${rangeIdentity}|end:${endBucket}|providers:${providers}`;
}
