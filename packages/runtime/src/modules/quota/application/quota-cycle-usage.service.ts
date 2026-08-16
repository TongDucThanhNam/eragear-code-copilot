import type {
  UsageStatsCliProviderId,
  UsageStatsCliSummary,
  UsageStatsCostTotals,
  UsageStatsModelUsage,
  UsageStatsQuotaWindowSnapshot,
  UsageStatsRecord,
  UsageStatsTokenTotals,
} from "#runtime/modules/usage-stats/application/contracts/usage-stats.contract";
import type { UsageStatsRepositoryPort } from "#runtime/modules/usage-stats/application/ports/usage-stats-repository.port";
import type { UsageStatsScannerPort } from "#runtime/modules/usage-stats/application/ports/usage-stats-scanner.port";
import type {
  GetQuotaCycleUsageInput,
  ProviderQuotaCycleUsage,
  ProviderQuotaListResult,
  ProviderQuotaSnapshot,
  QuotaCycleBoundarySource,
  QuotaCycleEfficiencyEstimate,
  QuotaCycleUsageResult,
  QuotaCycleUsageWindow,
  QuotaWindow,
} from "./contracts/quota.contract";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_LOOKBACK_MS = 90 * DAY_MS;
const RESET_MATCH_TOLERANCE_MS = 60 * 1000;
const MIN_QUOTA_POINT_DELTA = 0.25;
const BUILTIN_PROVIDER_PREFIX_RE = /^builtin:/;
const FIVE_HOUR_WINDOW_RE = /\b5\s*h(?:our)?s?\b/;
const DAILY_WINDOW_RE = /\b(?:day|daily|24\s*h)\b/;
const WEEKLY_WINDOW_RE = /\b(?:week|weekly|7\s*d)\b/;
const CORRELATED_CLI_PROVIDERS: UsageStatsCliProviderId[] = [
  "codex",
  "opencode",
  "zcode",
];

interface QuotaProviderReader {
  list(
    userId: string,
    input?: GetQuotaCycleUsageInput
  ): Promise<ProviderQuotaListResult>;
}

interface CycleBoundary {
  startMs?: number;
  endMs: number;
  source: QuotaCycleBoundarySource;
}

interface QuotaObservation {
  atMs: number;
  usedPoints: number;
}

interface FilteredUsage {
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
  activeDays: number;
  modelCount: number;
  warnings: string[];
}

export class QuotaCycleUsageService {
  private readonly repository: UsageStatsRepositoryPort;
  private readonly scanner: UsageStatsScannerPort;
  private readonly quotaProvider: QuotaProviderReader;
  private readonly nowMs: () => number;

  constructor(params: {
    repository: UsageStatsRepositoryPort;
    scanner: UsageStatsScannerPort;
    quotaProvider: QuotaProviderReader;
    nowMs?: () => number;
  }) {
    this.repository = params.repository;
    this.scanner = params.scanner;
    this.quotaProvider = params.quotaProvider;
    this.nowMs = params.nowMs ?? Date.now;
  }

  async get(
    userId: string,
    input?: GetQuotaCycleUsageInput
  ): Promise<QuotaCycleUsageResult> {
    const quotas = await this.quotaProvider.list(userId, input);
    const checkedAtMs = parseTimestamp(quotas.checkedAt) ?? this.nowMs();
    const history = await this.repository.listRecords(userId, {
      sinceMs: checkedAtMs - HISTORY_LOOKBACK_MS,
    });
    const scanCache = new Map<string, Promise<UsageStatsCliSummary>>();
    const providers = await Promise.all(
      quotas.providers.map((quota) =>
        this.buildProviderUsage(quota, history, checkedAtMs, scanCache)
      )
    );

    return {
      providers,
      checkedAt: quotas.checkedAt,
    };
  }

  private async buildProviderUsage(
    quota: ProviderQuotaSnapshot,
    history: UsageStatsRecord[],
    checkedAtMs: number,
    scanCache: Map<string, Promise<UsageStatsCliSummary>>
  ): Promise<ProviderQuotaCycleUsage> {
    const records = history.filter(
      (record) =>
        record.kind === "quota_refreshed" &&
        normalizeProviderId(record.providerId) ===
          normalizeProviderId(quota.providerId)
    );
    const cycles = await Promise.all(
      quota.windows.map((window) =>
        this.buildCycleUsage(quota, window, records, checkedAtMs, scanCache)
      )
    );
    return { quota, cycles };
  }

  private async buildCycleUsage(
    quota: ProviderQuotaSnapshot,
    window: QuotaWindow,
    history: UsageStatsRecord[],
    checkedAtMs: number,
    scanCache: Map<string, Promise<UsageStatsCliSummary>>
  ): Promise<QuotaCycleUsageWindow> {
    const matchingHistory = getMatchingHistory(window, history);
    const boundary = resolveCycleBoundary(window, matchingHistory, checkedAtMs);
    const observations = getQuotaObservations(
      window,
      quota,
      matchingHistory,
      boundary
    );
    const tracksToolCalls = window.usageKind === "tool_calls";
    const observed = tracksToolCalls
      ? {
          ...emptyFilteredUsage(),
          warnings: [
            "This quota tracks MCP tool calls; model-token logs do not measure it.",
          ],
        }
      : await this.scanProviderWindow(
          quota.providerId,
          boundary.startMs,
          boundary.endMs,
          scanCache
        );
    const estimate = tracksToolCalls
      ? unavailableEstimate(observations.length, [
          "This quota tracks MCP tool calls rather than model tokens.",
          "Use the provider-reported MCP counters instead of a token-capacity estimate.",
        ])
      : await this.buildEstimate({
          providerId: quota.providerId,
          window,
          boundary,
          observations,
          observed,
          scanCache,
        });

    return {
      windowId: window.id,
      label: window.label,
      ...(window.windowType ? { windowType: window.windowType } : {}),
      ...(boundary.startMs !== undefined
        ? { cycleStartedAt: new Date(boundary.startMs).toISOString() }
        : {}),
      ...(window.resetAt ? { resetAt: window.resetAt } : {}),
      boundarySource: boundary.source,
      observed: {
        ...(boundary.startMs !== undefined
          ? { from: new Date(boundary.startMs).toISOString() }
          : {}),
        to: new Date(boundary.endMs).toISOString(),
        partialCycle:
          boundary.source === "first_observation" ||
          boundary.source === "unavailable",
        localOnly: true,
        tokens: observed.tokens,
        apiEquivalent: observed.cost,
        activeDays: observed.activeDays,
        modelCount: observed.modelCount,
        warnings: observed.warnings,
      },
      estimate,
    };
  }

  private async buildEstimate(params: {
    providerId: string;
    window: QuotaWindow;
    boundary: CycleBoundary;
    observations: QuotaObservation[];
    observed: FilteredUsage;
    scanCache: Map<string, Promise<UsageStatsCliSummary>>;
  }): Promise<QuotaCycleEfficiencyEstimate> {
    const baseReasons = [
      "Only local Codex, OpenCode, and Zcode logs are counted; other devices and clients may be missing.",
      "The provider quota is opaque, so token capacity is a correlation estimate rather than a contractual limit.",
    ];
    if (params.window.unlimited) {
      return unavailableEstimate(params.observations.length, [
        ...baseReasons,
        "This quota window is reported as unlimited.",
      ]);
    }

    const current = params.observations.at(-1);
    if (!current) {
      return unavailableEstimate(params.observations.length, [
        ...baseReasons,
        "The provider did not report a usable remaining percentage.",
      ]);
    }

    const baseline = params.observations.find(
      (observation) =>
        observation.atMs < current.atMs &&
        current.usedPoints - observation.usedPoints >= MIN_QUOTA_POINT_DELTA
    );
    let quotaPointsObserved: number;
    let correlated = params.observed;
    let usedHistoricalDelta = false;

    if (baseline) {
      quotaPointsObserved = current.usedPoints - baseline.usedPoints;
      correlated = await this.scanProviderWindow(
        params.providerId,
        baseline.atMs,
        params.boundary.endMs,
        params.scanCache
      );
      usedHistoricalDelta = true;
    } else if (
      isExactBoundary(params.boundary.source) &&
      current.usedPoints >= MIN_QUOTA_POINT_DELTA
    ) {
      quotaPointsObserved = current.usedPoints;
    } else {
      return unavailableEstimate(params.observations.length, [
        ...baseReasons,
        params.boundary.source === "first_observation"
          ? "The app first observed this cycle after it had already started."
          : "At least two quota snapshots with measurable movement are needed.",
      ]);
    }

    if (correlated.tokens.totalTokens <= 0) {
      return unavailableEstimate(params.observations.length, [
        ...baseReasons,
        "Quota moved, but no matching local provider-attributed tokens were found in that interval.",
      ]);
    }

    const tokensPerQuotaPoint =
      correlated.tokens.totalTokens / quotaPointsObserved;
    const apiEquivalentPerQuotaPoint =
      correlated.cost.totalUsd > 0
        ? correlated.cost.totalUsd / quotaPointsObserved
        : undefined;
    const confidence = getConfidence({
      boundarySource: params.boundary.source,
      sampleCount: params.observations.length,
      quotaPointsObserved,
      usedHistoricalDelta,
    });
    const reasons = [...baseReasons];
    if (!usedHistoricalDelta) {
      reasons.push(
        "The estimate currently uses the provider-reported cycle start and one quota snapshot; another refresh after usage will improve it."
      );
    }
    if (correlated.warnings.length > 0) {
      reasons.push(...correlated.warnings);
    }

    return {
      confidence,
      sampleCount: params.observations.length,
      quotaPointsObserved,
      tokensPerQuotaPoint,
      projectedTokenCapacity: tokensPerQuotaPoint * 100,
      ...(apiEquivalentPerQuotaPoint !== undefined
        ? {
            apiEquivalentPerQuotaPoint,
            projectedApiEquivalent: apiEquivalentPerQuotaPoint * 100,
          }
        : {}),
      reasons,
    };
  }

  private async scanProviderWindow(
    providerId: string,
    startMs: number | undefined,
    endMs: number,
    scanCache: Map<string, Promise<UsageStatsCliSummary>>
  ): Promise<FilteredUsage> {
    if (startMs === undefined || startMs >= endMs) {
      return emptyFilteredUsage();
    }
    const key = `${startMs}:${endMs}`;
    let scan = scanCache.get(key);
    if (!scan) {
      scan = this.scanner.scan({
        range: "all",
        startMs,
        endMs,
        providers: CORRELATED_CLI_PROVIDERS,
      });
      scanCache.set(key, scan);
    }

    try {
      return filterProviderUsage(await scan, providerId);
    } catch (error) {
      scanCache.delete(key);
      return {
        ...emptyFilteredUsage(),
        warnings: [
          `Local usage scan failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

function getMatchingHistory(
  window: QuotaWindow,
  history: UsageStatsRecord[]
): Array<{ record: UsageStatsRecord; window: UsageStatsQuotaWindowSnapshot }> {
  const matches: Array<{
    record: UsageStatsRecord;
    window: UsageStatsQuotaWindowSnapshot;
  }> = [];
  for (const record of history) {
    const candidate = record.quotaWindows?.find(
      (entry) =>
        entry.id === window.id && windowsBelongToSameCycle(window, entry)
    );
    if (candidate) {
      matches.push({ record, window: candidate });
    }
  }
  return matches.sort(
    (left, right) => left.record.createdAt - right.record.createdAt
  );
}

function windowsBelongToSameCycle(
  current: QuotaWindow,
  candidate: UsageStatsQuotaWindowSnapshot
): boolean {
  const currentReset = parseTimestamp(current.resetAt);
  const candidateReset = parseTimestamp(candidate.resetAt);
  if (currentReset !== undefined) {
    return (
      candidateReset !== undefined &&
      Math.abs(currentReset - candidateReset) <= RESET_MATCH_TOLERANCE_MS
    );
  }
  const currentStart = parseTimestamp(current.startedAt);
  const candidateStart = parseTimestamp(candidate.startedAt);
  return (
    currentStart !== undefined &&
    candidateStart !== undefined &&
    Math.abs(currentStart - candidateStart) <= RESET_MATCH_TOLERANCE_MS
  );
}

function resolveCycleBoundary(
  window: QuotaWindow,
  history: Array<{
    record: UsageStatsRecord;
    window: UsageStatsQuotaWindowSnapshot;
  }>,
  checkedAtMs: number
): CycleBoundary {
  const resetMs = parseTimestamp(window.resetAt);
  const endMs =
    resetMs !== undefined && resetMs > 0
      ? Math.min(checkedAtMs, resetMs)
      : checkedAtMs;
  const providerStart = parseTimestamp(window.startedAt);
  if (isUsableStart(providerStart, endMs)) {
    return { startMs: providerStart, endMs, source: "provider_reported" };
  }

  const durationMs = window.durationMs ?? inferDurationMs(window);
  const derivedStart =
    resetMs !== undefined && durationMs !== undefined
      ? resetMs - durationMs
      : undefined;
  if (isUsableStart(derivedStart, endMs)) {
    return { startMs: derivedStart, endMs, source: "reset_duration" };
  }

  const firstObservedAt = history.at(0)?.record.createdAt;
  if (isUsableStart(firstObservedAt, endMs)) {
    return {
      startMs: firstObservedAt,
      endMs,
      source: "first_observation",
    };
  }
  return { endMs, source: "unavailable" };
}

function getQuotaObservations(
  window: QuotaWindow,
  quota: ProviderQuotaSnapshot,
  history: Array<{
    record: UsageStatsRecord;
    window: UsageStatsQuotaWindowSnapshot;
  }>,
  boundary: CycleBoundary
): QuotaObservation[] {
  const observations: QuotaObservation[] = [];
  for (const entry of history) {
    const usedPoints = getUsedQuotaPoints(entry.window);
    if (
      usedPoints !== undefined &&
      (boundary.startMs === undefined ||
        entry.record.createdAt >= boundary.startMs) &&
      entry.record.createdAt <= boundary.endMs
    ) {
      observations.push({ atMs: entry.record.createdAt, usedPoints });
    }
  }
  const currentUsedPoints = getUsedQuotaPoints(window);
  const currentAt = Math.min(
    parseTimestamp(quota.fetchedAt) ??
      parseTimestamp(quota.checkedAt) ??
      boundary.endMs,
    boundary.endMs
  );
  if (currentUsedPoints !== undefined) {
    observations.push({ atMs: currentAt, usedPoints: currentUsedPoints });
  }

  const unique = new Map<string, QuotaObservation>();
  for (const observation of observations) {
    unique.set(`${observation.atMs}:${observation.usedPoints}`, observation);
  }
  return [...unique.values()].sort((left, right) => left.atMs - right.atMs);
}

function getUsedQuotaPoints(window: {
  percentRemaining?: number;
  used?: number;
  total?: number;
}): number | undefined {
  if (window.percentRemaining !== undefined) {
    return clamp(100 - window.percentRemaining, 0, 100);
  }
  if (
    window.used !== undefined &&
    window.total !== undefined &&
    window.total > 0
  ) {
    return clamp((window.used / window.total) * 100, 0, 100);
  }
  return undefined;
}

function filterProviderUsage(
  summary: UsageStatsCliSummary,
  providerId: string
): FilteredUsage {
  const models = summary.modelUsage.filter((model) =>
    modelMatchesProvider(model, providerId)
  );
  const tokens = emptyTokens();
  const cost = emptyCost();
  for (const model of models) {
    addTokens(tokens, model.tokens);
    addCost(cost, model.cost);
  }
  const activeDays = summary.daily.filter((day) =>
    day.breakdown.some(
      (model) =>
        modelMatchesProvider(model, providerId) && model.tokens.totalTokens > 0
    )
  ).length;
  return {
    tokens,
    cost,
    activeDays,
    modelCount: new Set(
      models.map((model) => `${model.providerId}:${model.name}`)
    ).size,
    warnings: [...summary.warnings],
  };
}

function modelMatchesProvider(
  model: Pick<UsageStatsModelUsage, "providerId" | "upstreamProviderId">,
  providerId: string
): boolean {
  const expected = normalizeProviderId(providerId);
  const upstream = normalizeProviderId(model.upstreamProviderId);
  return (
    upstream === expected ||
    (expected === "openai" && model.providerId === "codex")
  );
}

function normalizeProviderId(providerId: string | undefined): string {
  const normalized = providerId?.trim().toLowerCase() ?? "";
  if (["openai", "chatgpt", "codex"].includes(normalized)) {
    return "openai";
  }
  if (normalized.includes("minimax")) {
    return "minimax-coding-plan";
  }
  if (
    normalized === "zai" ||
    normalized === "z.ai" ||
    normalized.includes("zai-coding-plan") ||
    normalized.startsWith("zcode")
  ) {
    return "zai";
  }
  return normalized.replace(BUILTIN_PROVIDER_PREFIX_RE, "");
}

function inferDurationMs(window: QuotaWindow): number | undefined {
  const value =
    `${window.windowType ?? ""} ${window.id} ${window.label}`.toLowerCase();
  if (FIVE_HOUR_WINDOW_RE.test(value)) {
    return 5 * 60 * 60 * 1000;
  }
  if (DAILY_WINDOW_RE.test(value)) {
    return DAY_MS;
  }
  if (WEEKLY_WINDOW_RE.test(value)) {
    return 7 * DAY_MS;
  }
  return undefined;
}

function getConfidence(params: {
  boundarySource: QuotaCycleBoundarySource;
  sampleCount: number;
  quotaPointsObserved: number;
  usedHistoricalDelta: boolean;
}): QuotaCycleEfficiencyEstimate["confidence"] {
  if (
    params.usedHistoricalDelta &&
    isExactBoundary(params.boundarySource) &&
    params.sampleCount >= 4 &&
    params.quotaPointsObserved >= 10
  ) {
    return "high";
  }
  if (
    params.usedHistoricalDelta &&
    params.sampleCount >= 2 &&
    params.quotaPointsObserved >= 2
  ) {
    return "medium";
  }
  return "low";
}

function isExactBoundary(source: QuotaCycleBoundarySource): boolean {
  return source === "provider_reported" || source === "reset_duration";
}

function unavailableEstimate(
  sampleCount: number,
  reasons: string[]
): QuotaCycleEfficiencyEstimate {
  return { confidence: "unavailable", sampleCount, reasons };
}

function emptyFilteredUsage(): FilteredUsage {
  return {
    tokens: emptyTokens(),
    cost: emptyCost(),
    activeDays: 0,
    modelCount: 0,
    warnings: [],
  };
}

function emptyTokens(): UsageStatsTokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheInputTokens: 0,
    cacheOutputTokens: 0,
    totalTokens: 0,
  };
}

function emptyCost(): UsageStatsCostTotals {
  return {
    inputUsd: 0,
    outputUsd: 0,
    cacheInputUsd: 0,
    cacheOutputUsd: 0,
    totalUsd: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
  };
}

function addTokens(
  target: UsageStatsTokenTotals,
  source: UsageStatsTokenTotals
): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheInputTokens += source.cacheInputTokens;
  target.cacheOutputTokens += source.cacheOutputTokens;
  target.totalTokens += source.totalTokens;
}

function addCost(
  target: UsageStatsCostTotals,
  source: UsageStatsCostTotals
): void {
  target.inputUsd += source.inputUsd;
  target.outputUsd += source.outputUsd;
  target.cacheInputUsd += source.cacheInputUsd;
  target.cacheOutputUsd += source.cacheOutputUsd;
  target.totalUsd += source.totalUsd;
  target.pricedTokens += source.pricedTokens;
  target.unpricedTokens += source.unpricedTokens;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isUsableStart(
  value: number | undefined,
  endMs: number
): value is number {
  return value !== undefined && value >= 0 && value < endMs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
