import { describe, expect, test } from "bun:test";
import type {
  UsageStatsCliSummary,
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "#runtime/modules/usage-stats/application/contracts/usage-stats.contract";
import type {
  MutableUsageTelemetrySettingsSnapshot,
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "#runtime/modules/usage-stats/application/ports/usage-stats-repository.port";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "#runtime/modules/usage-stats/application/ports/usage-stats-scanner.port";
import type { ProviderQuotaListResult } from "./contracts/quota.contract";
import { QuotaCycleUsageService } from "./quota-cycle-usage.service";

const CYCLE_START = Date.UTC(2026, 7, 9, 0);
const BASELINE_AT = Date.UTC(2026, 7, 9, 2);
const CHECKED_AT = Date.UTC(2026, 7, 9, 4);
const RESET_AT = Date.UTC(2026, 7, 9, 5);

class FakeUsageRepository implements UsageStatsRepositoryPort {
  private readonly records: UsageStatsRecord[];

  constructor(records: UsageStatsRecord[]) {
    this.records = records;
  }

  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord> {
    this.records.push(record);
    return Promise.resolve(record);
  }

  listRecords(): Promise<UsageStatsRecord[]> {
    return Promise.resolve([...this.records]);
  }

  readTelemetrySettings<T>(
    _userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(reader({ get: () => null }));
  }

  mutateTelemetrySettings<T>(
    _userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    let settings: UsageTelemetrySettings | null = null;
    return Promise.resolve(
      mutator({
        get: () => settings,
        set: (next) => {
          settings = next;
        },
      })
    );
  }
}

class FakeUsageScanner implements UsageStatsScannerPort {
  readonly inputs: UsageStatsScannerInput[] = [];

  scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    this.inputs.push(input);
    if (input.startMs === BASELINE_AT) {
      return Promise.resolve(createUsageSummary(4_000_000, 8));
    }
    return Promise.resolve(createUsageSummary(20_000_000, 40));
  }
}

describe("QuotaCycleUsageService", () => {
  test("correlates provider quota movement with provider-attributed local usage", async () => {
    const scanner = new FakeUsageScanner();
    const service = new QuotaCycleUsageService({
      repository: new FakeUsageRepository([
        createQuotaRecord({
          createdAt: BASELINE_AT,
          percentRemaining: 70,
        }),
      ]),
      scanner,
      quotaProvider: {
        list: () => Promise.resolve(createQuotaResult()),
      },
      nowMs: () => CHECKED_AT,
    });

    const result = await service.get("user-1");
    const cycle = result.providers[0]?.cycles[0];

    expect(cycle?.boundarySource).toBe("provider_reported");
    expect(cycle?.observed.tokens.totalTokens).toBe(20_000_000);
    expect(cycle?.observed.apiEquivalent.totalUsd).toBe(40);
    expect(cycle?.estimate.confidence).toBe("medium");
    expect(cycle?.estimate.sampleCount).toBe(2);
    expect(cycle?.estimate.quotaPointsObserved).toBe(18);
    expect(cycle?.estimate.tokensPerQuotaPoint).toBeCloseTo(4_000_000 / 18);
    expect(cycle?.estimate.projectedTokenCapacity).toBeCloseTo(
      (4_000_000 / 18) * 100
    );
    expect(cycle?.estimate.apiEquivalentPerQuotaPoint).toBeCloseTo(8 / 18);
    expect(scanner.inputs).toContainEqual({
      range: "all",
      startMs: CYCLE_START,
      endMs: CHECKED_AT,
      providers: ["codex", "opencode", "zcode"],
    });
    expect(scanner.inputs).toContainEqual({
      range: "all",
      startMs: BASELINE_AT,
      endMs: CHECKED_AT,
      providers: ["codex", "opencode", "zcode"],
    });
  });

  test("keeps capacity unavailable when only a partial cycle is observable", async () => {
    const result = await new QuotaCycleUsageService({
      repository: new FakeUsageRepository([
        createQuotaRecord({
          createdAt: BASELINE_AT,
          percentRemaining: 52,
        }),
      ]),
      scanner: new FakeUsageScanner(),
      quotaProvider: {
        list: () =>
          Promise.resolve(
            createQuotaResult({
              includeProviderStart: false,
              durationMs: false,
            })
          ),
      },
      nowMs: () => CHECKED_AT,
    }).get("user-1");

    const cycle = result.providers[0]?.cycles[0];
    expect(cycle?.boundarySource).toBe("first_observation");
    expect(cycle?.observed.partialCycle).toBe(true);
    expect(cycle?.estimate.confidence).toBe("unavailable");
    expect(cycle?.estimate.reasons.join(" ")).toContain("first observed");
  });
});

function createQuotaResult(
  options: { includeProviderStart?: boolean; durationMs?: boolean } = {}
): ProviderQuotaListResult {
  const includeProviderStart = options.includeProviderStart !== false;
  const includeDuration = options.durationMs !== false;
  return {
    checkedAt: new Date(CHECKED_AT).toISOString(),
    providers: [
      {
        providerId: "openai",
        displayName: "OpenAI / ChatGPT",
        aliases: ["codex"],
        source: "remote_api",
        status: "ready",
        attempted: true,
        checkedAt: new Date(CHECKED_AT).toISOString(),
        fetchedAt: new Date(CHECKED_AT).toISOString(),
        windows: [
          {
            id: "primary",
            label: "Primary",
            percentRemaining: 52,
            ...(includeProviderStart
              ? { startedAt: new Date(CYCLE_START).toISOString() }
              : {}),
            resetAt: new Date(RESET_AT).toISOString(),
            ...(includeDuration ? { durationMs: 5 * 60 * 60 * 1000 } : {}),
          },
        ],
      },
    ],
  };
}

function createQuotaRecord(params: {
  createdAt: number;
  percentRemaining: number;
}): UsageStatsRecord {
  return {
    id: `quota-${params.createdAt}`,
    userId: "user-1",
    kind: "quota_refreshed",
    providerId: "openai",
    providerDisplayName: "OpenAI / ChatGPT",
    status: "ready",
    quotaWindows: [
      {
        id: "primary",
        label: "Primary",
        percentRemaining: params.percentRemaining,
        resetAt: new Date(RESET_AT).toISOString(),
      },
    ],
    createdAt: params.createdAt,
  };
}

function createUsageSummary(
  totalTokens: number,
  totalUsd: number
): UsageStatsCliSummary {
  const tokens = {
    inputTokens: totalTokens * 0.8,
    outputTokens: totalTokens * 0.2,
    cacheInputTokens: totalTokens * 0.5,
    cacheOutputTokens: 0,
    totalTokens,
  };
  const cost = {
    inputUsd: totalUsd * 0.8,
    outputUsd: totalUsd * 0.2,
    cacheInputUsd: 0,
    cacheOutputUsd: 0,
    totalUsd,
    pricedTokens: totalTokens,
    unpricedTokens: 0,
  };
  const model = {
    name: "gpt-5.6-sol",
    providerId: "codex" as const,
    providerDisplayName: "Codex",
    upstreamProviderId: "openai",
    tokens,
    cost,
    share: 1,
  };
  return {
    range: "all",
    providers: [],
    totals: tokens,
    cost,
    pricing: {
      source: "test",
      generatedAt: CHECKED_AT,
      units: "USD per 1M tokens",
      pricedTokens: totalTokens,
      unpricedTokens: 0,
    },
    daily: [
      {
        date: "2026-08-09",
        tokens,
        cost,
        displayTokens: totalTokens,
        breakdown: [model],
        providers: [],
      },
    ],
    modelUsage: [model],
    favoriteModel: model,
    recentFavoriteModel: model,
    activeDays: 1,
    currentStreak: 1,
    longestStreak: 1,
    warnings: [],
    checkedAt: CHECKED_AT,
  };
}
