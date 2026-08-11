import { describe, expect, test } from "bun:test";
import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";
import { CachedUsageStatsScannerAdapter } from "./cached-usage-stats-scanner.adapter";

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

    const nextEndBucket = await scanner.scan({ ...baseInput, endMs: 15_001 });
    expect(delegate.calls).toBe(2);
    expect(nextEndBucket.checkedAt).toBe(15_001);

    nowMs += 101;
    const refreshed = await scanner.scan({ ...baseInput, endMs: 40 });
    expect(delegate.calls).toBe(3);
    expect(refreshed.checkedAt).toBe(40);
  });

  test("keeps exact all-range cycle starts in separate cache entries", async () => {
    const delegate = new CountingScanner();
    const scanner = new CachedUsageStatsScannerAdapter(delegate);

    await scanner.scan({ range: "all", startMs: 10, endMs: 20 });
    await scanner.scan({ range: "all", startMs: 11, endMs: 20 });

    expect(delegate.calls).toBe(2);
  });
});
