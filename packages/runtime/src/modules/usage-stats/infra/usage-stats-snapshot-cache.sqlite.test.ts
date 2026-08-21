import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  UsageStatsCliSummary,
  UsageStatsCostTotals,
  UsageStatsTokenTotals,
} from "../application/contracts/usage-stats.contract";
import { UsageStatsSnapshotSqliteCache } from "./usage-stats-snapshot-cache.sqlite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("UsageStatsSnapshotSqliteCache", () => {
  test("persists a validated usage summary across cache instances", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "eragear-usage-snapshot-")
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "snapshots.sqlite");
    const summary = createSummary(1234);
    const writer = new UsageStatsSnapshotSqliteCache({
      filePath: () => filePath,
    });

    writer.write("30d|providers:*", summary, 2000);
    writer.close();

    const reader = new UsageStatsSnapshotSqliteCache({
      filePath: () => filePath,
    });
    expect(reader.read("30d|providers:*", 1999)).toEqual(summary);
    expect(reader.read("30d|providers:*", 2001)).toBeUndefined();
    reader.close();
  });

  test("prunes snapshots beyond the configured entry cap", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "eragear-usage-snapshot-cap-")
    );
    temporaryDirectories.push(directory);
    const cache = new UsageStatsSnapshotSqliteCache({
      filePath: () => path.join(directory, "snapshots.sqlite"),
      maxEntries: 2,
    });

    cache.write("7d|providers:*", createSummary(1), 1);
    cache.write("30d|providers:*", createSummary(2), 2);
    cache.write("start:0|providers:*", createSummary(3), 3);

    expect(cache.read("7d|providers:*", 0)).toBeUndefined();
    expect(cache.read("30d|providers:*", 0)?.checkedAt).toBe(2);
    expect(cache.read("start:0|providers:*", 0)?.checkedAt).toBe(3);
    cache.close();
  });
});

function createSummary(checkedAt: number): UsageStatsCliSummary {
  const totals: UsageStatsTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheInputTokens: 0,
    cacheOutputTokens: 0,
    totalTokens: 0,
  };
  const cost: UsageStatsCostTotals = {
    inputUsd: 0,
    outputUsd: 0,
    cacheInputUsd: 0,
    cacheOutputUsd: 0,
    totalUsd: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
  };
  return {
    range: "30d",
    providers: [],
    totals,
    cost,
    pricing: {
      source: "test",
      generatedAt: 0,
      units: "USD per 1M tokens",
      pricedTokens: 0,
      unpricedTokens: 0,
    },
    daily: [],
    modelUsage: [],
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    warnings: [],
    checkedAt,
    refreshing: false,
  };
}
