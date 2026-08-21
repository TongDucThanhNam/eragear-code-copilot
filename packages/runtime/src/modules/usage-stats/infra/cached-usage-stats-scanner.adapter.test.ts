import { describe, expect, test } from "bun:test";
import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";
import {
  CachedUsageStatsScannerAdapter,
  type UsageStatsSnapshotCachePort,
} from "./cached-usage-stats-scanner.adapter";

class CountingScanner implements UsageStatsScannerPort {
  calls = 0;

  async scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    this.calls += 1;
    await Promise.resolve();
    return {
      checkedAt: input.endMs,
      range: input.range,
    } as UsageStatsCliSummary;
  }
}

class MemorySnapshotCache implements UsageStatsSnapshotCachePort {
  private readonly entries = new Map<
    string,
    { result: UsageStatsCliSummary; savedAtMs: number }
  >();

  read(key: string, minSavedAtMs: number): UsageStatsCliSummary | undefined {
    const entry = this.entries.get(key);
    return entry && entry.savedAtMs >= minSavedAtMs ? entry.result : undefined;
  }

  write(key: string, result: UsageStatsCliSummary, savedAtMs: number): void {
    this.entries.set(key, { result, savedAtMs });
  }
}

class DeferredScanner implements UsageStatsScannerPort {
  calls = 0;
  private resolveScan?: (summary: UsageStatsCliSummary) => void;

  scan(_input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    this.calls += 1;
    return new Promise((resolve) => {
      this.resolveScan = resolve;
    });
  }

  resolve(summary: UsageStatsCliSummary): void {
    this.resolveScan?.(summary);
  }
}

describe("CachedUsageStatsScannerAdapter", () => {
  test("coalesces equivalent scans and expires cached results", async () => {
    let nowMs = 1000;
    const delegate = new CountingScanner();
    const scanner = new CachedUsageStatsScannerAdapter(delegate, {
      cacheTtlMs: 100,
      nowMs: () => nowMs,
    });
    const baseInput: UsageStatsScannerInput = {
      range: "30d",
      startMs: 10,
      endMs: 20,
      providers: ["codex", "opencode"],
    };

    const [first, coalesced] = await Promise.all([
      scanner.scan(baseInput),
      scanner.scan({
        ...baseInput,
        startMs: 11,
        endMs: 21,
        providers: ["opencode", "codex"],
      }),
    ]);
    const cached = await scanner.scan({ ...baseInput, endMs: 30 });

    expect(delegate.calls).toBe(1);
    expect(coalesced).toBe(first);
    expect(cached).toBe(first);

    const laterEnd = await scanner.scan({ ...baseInput, endMs: 15_001 });
    expect(delegate.calls).toBe(1);
    expect(laterEnd).toBe(first);

    nowMs += 101;
    const refreshed = await scanner.scan({ ...baseInput, endMs: 40 });
    expect(delegate.calls).toBe(2);
    expect(refreshed.checkedAt).toBe(40);
  });

  test("keeps exact all-range cycle starts in separate cache entries", async () => {
    const delegate = new CountingScanner();
    const scanner = new CachedUsageStatsScannerAdapter(delegate);

    await scanner.scan({ range: "all", startMs: 10, endMs: 20 });
    await scanner.scan({ range: "all", startMs: 11, endMs: 20 });

    expect(delegate.calls).toBe(2);
  });

  test("returns a durable snapshot immediately and coalesces the background refresh", async () => {
    let nowMs = 1000;
    const snapshotCache = new MemorySnapshotCache();
    const input: UsageStatsScannerInput = {
      range: "30d",
      startMs: 10,
      endMs: 20,
    };
    const initialScanner = new CachedUsageStatsScannerAdapter(
      new CountingScanner(),
      { nowMs: () => nowMs, snapshotCache }
    );
    const initial = await initialScanner.scan(input);
    expect(initial.refreshing).toBe(false);

    nowMs += 1000;
    const delegate = new DeferredScanner();
    const scanner = new CachedUsageStatsScannerAdapter(delegate, {
      nowMs: () => nowMs,
      snapshotCache,
    });
    const snapshot = await scanner.scan({ ...input, endMs: 2000 });

    expect(snapshot.checkedAt).toBe(20);
    expect(snapshot.refreshing).toBe(true);
    expect(delegate.calls).toBe(1);

    const freshPromise = scanner.scan({ ...input, endMs: 2001 });
    delegate.resolve({ ...initial, checkedAt: 2001 });
    const fresh = await freshPromise;

    expect(fresh.checkedAt).toBe(2001);
    expect(fresh.refreshing).toBe(false);
    expect(delegate.calls).toBe(1);
  });
});
