import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";

const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedScanEntry {
  expiresAtMs: number;
  result: UsageStatsCliSummary;
}

export interface UsageStatsSnapshotCachePort {
  read(key: string, minSavedAtMs: number): UsageStatsCliSummary | undefined;
  write(key: string, result: UsageStatsCliSummary, savedAtMs: number): void;
}

export class CachedUsageStatsScannerAdapter implements UsageStatsScannerPort {
  private readonly delegate: UsageStatsScannerPort;
  private readonly cacheTtlMs: number;
  private readonly maxEntries: number;
  private readonly nowMs: () => number;
  private readonly snapshotCache?: UsageStatsSnapshotCachePort;
  private readonly snapshotMaxAgeMs: number;
  private readonly cache = new Map<string, CachedScanEntry>();
  private readonly inFlight = new Map<string, Promise<UsageStatsCliSummary>>();

  constructor(
    delegate: UsageStatsScannerPort,
    options: {
      cacheTtlMs?: number;
      maxEntries?: number;
      nowMs?: () => number;
      snapshotCache?: UsageStatsSnapshotCachePort;
      snapshotMaxAgeMs?: number;
    } = {}
  ) {
    this.delegate = delegate;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.nowMs = options.nowMs ?? Date.now;
    this.snapshotCache = options.snapshotCache;
    this.snapshotMaxAgeMs = Math.max(
      0,
      options.snapshotMaxAgeMs ?? DEFAULT_SNAPSHOT_MAX_AGE_MS
    );
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

    const snapshot = this.readSnapshot(key, input, nowMs);
    if (snapshot) {
      const operation = this.startScan(key, input, snapshot);
      // The current caller receives the durable snapshot immediately. Keep a
      // rejection handler attached in case it does not request the fresh value.
      operation.catch(() => undefined);
      return Promise.resolve(markRefreshing(snapshot, true));
    }

    return this.startScan(key, input);
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

  private startScan(
    key: string,
    input: UsageStatsScannerInput,
    fallback?: UsageStatsCliSummary
  ): Promise<UsageStatsCliSummary> {
    const operation = this.delegate
      .scan(input)
      .then((result) => {
        const freshResult = markRefreshing(result, false);
        this.store(key, freshResult);
        this.writeSnapshot(key, input, freshResult);
        return freshResult;
      })
      .catch((error: unknown) => {
        if (!fallback) {
          throw error;
        }
        const result = markRefreshing(fallback, false, [
          ...fallback.warnings,
          "Background usage refresh failed; showing the last successful local snapshot.",
        ]);
        this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, operation);
    return operation;
  }

  private readSnapshot(
    key: string,
    input: UsageStatsScannerInput,
    nowMs: number
  ): UsageStatsCliSummary | undefined {
    if (!(this.snapshotCache && isDurableSnapshotInput(input))) {
      return undefined;
    }
    try {
      return this.snapshotCache.read(key, nowMs - this.snapshotMaxAgeMs);
    } catch {
      return undefined;
    }
  }

  private writeSnapshot(
    key: string,
    input: UsageStatsScannerInput,
    result: UsageStatsCliSummary
  ): void {
    if (!(this.snapshotCache && isDurableSnapshotInput(input))) {
      return;
    }
    try {
      this.snapshotCache.write(key, result, this.nowMs());
    } catch {
      // A durable snapshot is an optimization; the live scan remains canonical.
    }
  }
}

function createCacheKey(input: UsageStatsScannerInput): string {
  const providers = input.providers?.length
    ? [...new Set(input.providers)].sort().join(",")
    : "*";
  const rangeIdentity =
    input.range === "all" ? `start:${input.startMs ?? 0}` : input.range;
  return `${rangeIdentity}|providers:${providers}`;
}

function isDurableSnapshotInput(input: UsageStatsScannerInput): boolean {
  return input.range !== "all" || input.startMs === undefined;
}

function markRefreshing(
  result: UsageStatsCliSummary,
  refreshing: boolean,
  warnings = result.warnings
): UsageStatsCliSummary {
  return {
    ...result,
    warnings,
    refreshing,
  };
}
