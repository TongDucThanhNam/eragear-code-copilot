import { Database } from "bun:sqlite";
import {
  createReadStream,
  type Dirent,
  existsSync,
  readdirSync,
} from "node:fs";
import { copyFile, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { file as bunFile, write as bunWrite } from "bun";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type {
  UsageStatsCliDailyUsage,
  UsageStatsCliProviderId,
  UsageStatsCliProviderSummary,
  UsageStatsCliSummary,
  UsageStatsCostTotals,
  UsageStatsDailyModelUsage,
  UsageStatsModelUsage,
  UsageStatsProviderDailyUsage,
  UsageStatsTokenTotals,
} from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";
import {
  addCost,
  calculateUsageCost,
  cloneCost,
  createEmptyCost,
  getUsagePricingMetadata,
  loadUsagePricingSnapshot,
  type PricingSnapshot,
} from "./usage-pricing";

const CLI_PROVIDER_IDS: UsageStatsCliProviderId[] = [
  "amp",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
  "zcode",
];

const PROVIDER_DISPLAY_NAMES: Record<UsageStatsCliProviderId, string> = {
  amp: "Amp",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  pi: "Pi Coding Agent",
  zcode: "Zcode Agent",
};

const FILE_PROCESS_CONCURRENCY_ENV = "SLOPMETER_FILE_PROCESS_CONCURRENCY";
const MAX_JSON_RECORD_BYTES_ENV = "SLOPMETER_MAX_JSONL_RECORD_BYTES";
const PROVIDER_SCAN_TIMEOUT_MS_ENV = "SLOPMETER_PROVIDER_SCAN_TIMEOUT_MS";
const DEFAULT_FILE_PROCESS_CONCURRENCY = 16;
const DEFAULT_MAX_JSON_RECORD_BYTES = 64 * 1024 * 1024;
const DEFAULT_PROVIDER_SCAN_TIMEOUT_MS: Record<
  UsageStatsCliProviderId,
  number
> = {
  amp: 12_000,
  claude: 12_000,
  codex: 120_000,
  cursor: 12_000,
  gemini: 12_000,
  opencode: 12_000,
  pi: 12_000,
  zcode: 12_000,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const GEMINI_SESSION_FILE_RE = /[\\/]chats[\\/]session-[^\\/]+\.json$/;
const CURSOR_WEB_BASE_TRAILING_SLASH_RE = /\/+$/;
const CSV_LINE_RE = /\r?\n/;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SQLITE_LOCKED_RE = /database is locked|SQLITE_BUSY/i;
const MODEL_DATE_SUFFIX_RE = /-\d{8}$/;
const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9._-]+/g;
const BUILTIN_PROVIDER_PREFIX_RE = /^builtin:/;
const CODEX_RELEVANT_JSONL_MARKERS = ["token_count", "turn_context"] as const;
const CODEX_SESSION_META_PREFIX_BYTES = 64 * 1024;
const CODEX_SUBAGENT_THREAD_SOURCE_RE = /"thread_source"\s*:\s*"subagent"/;
const CODEX_SUBAGENT_SOURCE_RE = /"source"\s*:\s*\{\s*"subagent"\s*:/;
const CODEX_USAGE_INDEX_VERSION = 3;
const CODEX_USAGE_INDEX_FILENAME = "usage-codex-index-v1.json";

interface MutableDailyUsage {
  date: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
  models: Map<string, UsageStatsTokenTotals>;
  modelCosts: Map<string, UsageStatsCostTotals>;
}

interface MutableProviderUsage {
  providerId: UsageStatsCliProviderId;
  pricingSnapshot: PricingSnapshot;
  daily: Map<string, MutableDailyUsage>;
  modelTotals: Map<string, UsageStatsTokenTotals>;
  modelCosts: Map<string, UsageStatsCostTotals>;
  recentModelTotals: Map<string, UsageStatsTokenTotals>;
  recentModelCosts: Map<string, UsageStatsCostTotals>;
}

interface CodexUsagePayload {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface NormalizedCodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface CodexIndexedUsageEvent {
  atMs: number;
  modelName?: string;
  tokens: UsageStatsTokenTotals;
}

interface CodexJsonlEntry {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    model_name?: string;
    metadata?: { model?: string };
    info?: {
      model?: string;
      model_name?: string;
      metadata?: { model?: string };
      last_token_usage?: CodexUsagePayload;
      total_token_usage?: CodexUsagePayload;
    };
  };
}

interface CodexFileModelContext {
  currentModel?: string;
  isSubagentSession: boolean;
  explicitModels: Set<string>;
}

interface CodexFileIndexEntry {
  size: number;
  lastModified: number;
  events: CodexIndexedUsageEvent[];
}

interface PersistedCodexUsageIndex {
  version: number;
  files: Record<string, CodexFileIndexEntry>;
}

interface LocalCliUsageScannerOptions {
  codexIndexFilePath?: () => string;
  persistCodexIndex?: boolean;
}

interface AmpThread {
  created?: number;
  messages?: AmpMessage[];
}

interface AmpMessage {
  role?: string;
  usage?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  meta?: { sentAt?: number };
}

interface ClaudeRawLogEntry {
  timestamp?: string;
  requestId?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    model?: string;
    id?: string;
  };
}

interface CursorCsvRow {
  Date?: string;
  Model?: string;
  Tokens?: string;
  "Input (w/ Cache Write)"?: string;
  "Input (w/o Cache Write)"?: string;
  "Cache Read"?: string;
  "Output Tokens"?: string;
  "Total Tokens"?: string;
}

interface ZcodeModelUsageRow {
  id?: string;
  provider_id?: string;
  model_id?: string;
  status?: string;
  started_at?: number;
  completed_at?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  computed_total_tokens?: number;
  provider_total_tokens?: number;
}

export class LocalCliUsageScannerAdapter implements UsageStatsScannerPort {
  private readonly codexUsageIndex: CodexUsageIndex;

  constructor(options: LocalCliUsageScannerOptions = {}) {
    this.codexUsageIndex = new CodexUsageIndex(
      options.persistCodexIndex === false
        ? undefined
        : (options.codexIndexFilePath ??
            (() => getStorageFileSync(CODEX_USAGE_INDEX_FILENAME)))
    );
  }

  async scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    const start =
      input.startMs === undefined ? new Date(0) : new Date(input.startMs);
    const end = new Date(input.endMs);
    const recentStart = getRecentWindowStart(end);
    const providers = input.providers?.length
      ? input.providers
      : CLI_PROVIDER_IDS;
    const warnings: string[] = [];
    const summaries: UsageStatsCliProviderSummary[] = [];
    const pricingSnapshot = await loadUsagePricingSnapshot(warnings);

    summaries.push(
      ...(await Promise.all(
        providers.map((providerId) =>
          this.scanProvider(
            providerId,
            start,
            end,
            recentStart,
            warnings,
            pricingSnapshot
          )
        )
      ))
    );

    return buildCliSummary({
      range: input.range,
      providers: summaries,
      checkedAt: input.endMs,
      warnings,
      recentStart,
      end,
      pricingSnapshot,
    });
  }

  private async scanProvider(
    providerId: UsageStatsCliProviderId,
    start: Date,
    end: Date,
    recentStart: Date,
    warnings: string[],
    pricingSnapshot: PricingSnapshot
  ): Promise<UsageStatsCliProviderSummary> {
    try {
      const usage = await withProviderScanTimeout(
        providerId,
        this.loadProviderUsage(
          providerId,
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        )
      );

      if (!usage) {
        return buildProviderSummary(
          providerId,
          "not_found",
          createProviderUsage(providerId, pricingSnapshot),
          end
        );
      }

      return buildProviderSummary(providerId, "ready", usage, end);
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      warnings.push(
        `${PROVIDER_DISPLAY_NAMES[providerId]} scan failed: ${message}`
      );
      return buildProviderSummary(
        providerId,
        "error",
        createProviderUsage(providerId, pricingSnapshot),
        end,
        message
      );
    }
  }

  private async loadProviderUsage(
    providerId: UsageStatsCliProviderId,
    start: Date,
    end: Date,
    recentStart: Date,
    warnings: string[],
    pricingSnapshot: PricingSnapshot
  ): Promise<MutableProviderUsage | null> {
    switch (providerId) {
      case "amp":
        return await loadAmpUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        );
      case "claude":
        return await loadClaudeUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        );
      case "codex":
        return await loadCodexUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot,
          this.codexUsageIndex
        );
      case "cursor":
        return await loadCursorUsage(start, end, recentStart, pricingSnapshot);
      case "gemini":
        return await loadGeminiUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        );
      case "opencode":
        return await loadOpenCodeUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        );
      case "pi":
        return await loadPiUsage(
          start,
          end,
          recentStart,
          warnings,
          pricingSnapshot
        );
      case "zcode":
        return await loadZcodeUsage(start, end, recentStart, pricingSnapshot);
      default: {
        const exhaustive: never = providerId;
        throw new Error(`Unhandled usage provider: ${String(exhaustive)}`);
      }
    }
  }
}

class CodexUsageIndex {
  private readonly filePath?: () => string;
  private readonly entries = new Map<string, CodexFileIndexEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<CodexIndexedUsageEvent[]>
  >();
  private loadPromise?: Promise<void>;
  private flushPromise: Promise<void> = Promise.resolve();
  private revision = 0;
  private flushedRevision = 0;

  constructor(filePath?: () => string) {
    this.filePath = filePath;
  }

  async getEvents(
    file: string,
    warnings: string[]
  ): Promise<CodexIndexedUsageEvent[]> {
    await this.ensureLoaded();
    const cacheKey = path.resolve(file);
    const source = bunFile(cacheKey);
    const sourceSize = source.size;
    const sourceLastModified = source.lastModified;
    const cached = this.entries.get(cacheKey);
    if (
      cached &&
      cached.size === sourceSize &&
      cached.lastModified === sourceLastModified
    ) {
      return cached.events;
    }

    const active = this.inFlight.get(cacheKey);
    if (active) {
      return active;
    }
    const operation = readCodexIndexedEvents(cacheKey, warnings)
      .then((events) => {
        this.entries.set(cacheKey, {
          size: sourceSize,
          lastModified: sourceLastModified,
          events,
        });
        this.revision += 1;
        return events;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
    this.inFlight.set(cacheKey, operation);
    return operation;
  }

  flush(): Promise<void> {
    if (!(this.filePath && this.revision > this.flushedRevision)) {
      return this.flushPromise;
    }
    this.flushPromise = this.flushPromise.then(async () => {
      if (!(this.filePath && this.revision > this.flushedRevision)) {
        return;
      }
      const revision = this.revision;
      const filePath = this.filePath();
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      const payload: PersistedCodexUsageIndex = {
        version: CODEX_USAGE_INDEX_VERSION,
        files: Object.fromEntries(this.entries),
      };
      const serialized = JSON.stringify(payload);
      let persisted = false;
      try {
        await bunWrite(temporaryPath, serialized);
        await rename(temporaryPath, filePath);
        persisted = true;
      } catch {
        try {
          await bunWrite(filePath, serialized);
          persisted = true;
        } catch {
          // Persistence is an optimization; source logs remain authoritative.
        }
        try {
          await rm(temporaryPath, { force: true });
        } catch {
          // Best-effort cleanup of an interrupted cache write.
        }
      }
      if (persisted) {
        this.flushedRevision = revision;
      }
    });
    return this.flushPromise;
  }

  private ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    if (!this.filePath) {
      return;
    }
    try {
      const source = bunFile(this.filePath());
      if (!(await source.exists())) {
        return;
      }
      const parsed = (await source.json()) as PersistedCodexUsageIndex;
      if (
        parsed.version !== CODEX_USAGE_INDEX_VERSION ||
        !parsed.files ||
        typeof parsed.files !== "object"
      ) {
        return;
      }
      for (const [file, entry] of Object.entries(parsed.files)) {
        if (isCodexFileIndexEntry(entry)) {
          this.entries.set(file, entry);
        }
      }
    } catch {
      // A missing or partial cache only costs a rebuild; source logs remain authoritative.
    }
  }
}

function createEmptyTokens(): UsageStatsTokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheInputTokens: 0,
    cacheOutputTokens: 0,
    totalTokens: 0,
  };
}

function cloneTokens(tokens: UsageStatsTokenTotals): UsageStatsTokenTotals {
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheInputTokens: tokens.cacheInputTokens,
    cacheOutputTokens: tokens.cacheOutputTokens,
    totalTokens: tokens.totalTokens,
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

function createProviderUsage(
  providerId: UsageStatsCliProviderId,
  pricingSnapshot: PricingSnapshot
): MutableProviderUsage {
  return {
    providerId,
    pricingSnapshot,
    daily: new Map(),
    modelTotals: new Map(),
    modelCosts: new Map(),
    recentModelTotals: new Map(),
    recentModelCosts: new Map(),
  };
}

function recordUsage(params: {
  usage: MutableProviderUsage;
  date: Date;
  tokens: UsageStatsTokenTotals;
  modelName?: string;
  upstreamProviderId?: string;
  recentStart: Date;
}): void {
  if (params.tokens.totalTokens <= 0 || Number.isNaN(params.date.getTime())) {
    return;
  }

  const cost = calculateUsageCost({
    providerId: params.usage.providerId,
    modelName: params.modelName,
    tokens: params.tokens,
    pricingSnapshot: params.usage.pricingSnapshot,
  });
  const dateKey = formatLocalDate(params.date);
  let daily = params.usage.daily.get(dateKey);

  if (!daily) {
    daily = {
      date: dateKey,
      tokens: createEmptyTokens(),
      cost: createEmptyCost(),
      models: new Map(),
      modelCosts: new Map(),
    };
    params.usage.daily.set(dateKey, daily);
  }

  addTokens(daily.tokens, params.tokens);
  addCost(daily.cost, cost);

  const modelUsageName = normalizeModelUsageName(params.modelName);
  if (!modelUsageName) {
    return;
  }
  const upstreamProviderId = normalizeUpstreamProviderId(
    params.upstreamProviderId
  );
  const usageKey = usageModelKey(modelUsageName, upstreamProviderId);

  addModelTokens(daily.models, usageKey, params.tokens);
  addModelCost(daily.modelCosts, usageKey, cost);
  addModelTokens(params.usage.modelTotals, usageKey, params.tokens);
  addModelCost(params.usage.modelCosts, usageKey, cost);

  if (params.date >= params.recentStart) {
    addModelTokens(params.usage.recentModelTotals, usageKey, params.tokens);
    addModelCost(params.usage.recentModelCosts, usageKey, cost);
  }
}

function addModelTokens(
  map: Map<string, UsageStatsTokenTotals>,
  name: string,
  tokens: UsageStatsTokenTotals
): void {
  const existing = map.get(name);
  if (!existing) {
    map.set(name, cloneTokens(tokens));
    return;
  }
  addTokens(existing, tokens);
}

function addModelCost(
  map: Map<string, UsageStatsCostTotals>,
  name: string,
  cost: UsageStatsCostTotals
): void {
  const existing = map.get(name);
  if (!existing) {
    map.set(name, cloneCost(cost));
    return;
  }
  addCost(existing, cost);
}

function buildProviderSummary(
  providerId: UsageStatsCliProviderId,
  status: UsageStatsCliProviderSummary["status"],
  usage: MutableProviderUsage,
  end: Date,
  error?: string
): UsageStatsCliProviderSummary {
  const totals = createEmptyTokens();
  const cost = createEmptyCost();
  for (const daily of usage.daily.values()) {
    addTokens(totals, daily.tokens);
    addCost(cost, daily.cost);
  }
  const daily = buildDailyRows(usage.daily, {
    providerId,
    providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
  });
  const modelUsage = buildModelUsageRows(
    usage.modelTotals,
    usage.modelCosts,
    providerId,
    totals.totalTokens
  );
  const recentModelUsage = buildModelUsageRows(
    usage.recentModelTotals,
    usage.recentModelCosts,
    providerId,
    sumTokenMap(usage.recentModelTotals).totalTokens
  );
  const measuredDaily = daily.filter((row) => row.displayTokens > 0);

  return {
    providerId,
    providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
    status,
    ...(error ? { error } : {}),
    totals,
    cost,
    daily,
    modelUsage,
    favoriteModel: modelUsage[0],
    recentFavoriteModel: recentModelUsage[0],
    activeDays: measuredDaily.length,
    currentStreak: computeCurrentStreak(measuredDaily, end),
    longestStreak: computeLongestStreak(measuredDaily),
  };
}

function buildCliSummary(params: {
  range: UsageStatsScannerInput["range"];
  providers: UsageStatsCliProviderSummary[];
  checkedAt: number;
  warnings: string[];
  recentStart: Date;
  end: Date;
  pricingSnapshot: PricingSnapshot;
}): UsageStatsCliSummary {
  const dailyByDate = new Map<string, MutableDailyUsage>();
  const providerDailyByDate = new Map<string, UsageStatsProviderDailyUsage[]>();
  const modelTotals = new Map<string, UsageStatsModelUsage>();
  const recentModelTotals = new Map<string, UsageStatsModelUsage>();
  const totals = createEmptyTokens();
  const cost = createEmptyCost();

  for (const provider of params.providers) {
    addTokens(totals, provider.totals);
    addCost(cost, provider.cost);

    for (const row of provider.daily) {
      let daily = dailyByDate.get(row.date);
      if (!daily) {
        daily = {
          date: row.date,
          tokens: createEmptyTokens(),
          cost: createEmptyCost(),
          models: new Map(),
          modelCosts: new Map(),
        };
        dailyByDate.set(row.date, daily);
      }
      addTokens(daily.tokens, row.tokens);
      addCost(daily.cost, row.cost);

      const providerEntries = providerDailyByDate.get(row.date) ?? [];
      providerEntries.push({
        providerId: provider.providerId,
        providerDisplayName: provider.providerDisplayName,
        tokens: cloneTokens(row.tokens),
        cost: cloneCost(row.cost),
      });
      providerDailyByDate.set(row.date, providerEntries);

      for (const model of row.breakdown) {
        const key = modelKey(
          model.providerId,
          model.name,
          model.upstreamProviderId
        );
        addModelTokens(daily.models, key, model.tokens);
        addModelCost(daily.modelCosts, key, model.cost);
      }
    }

    for (const model of provider.modelUsage) {
      addModelUsageSummary(modelTotals, model);
    }

    for (const model of provider.modelUsage) {
      const recentProviderTotal = provider.daily
        .filter((row) => new Date(`${row.date}T00:00:00`) >= params.recentStart)
        .reduce((sum, row) => sum + row.tokens.totalTokens, 0);
      if (recentProviderTotal <= 0) {
        continue;
      }
      const recentModel = provider.recentFavoriteModel;
      if (recentModel && recentModel.name === model.name) {
        addModelUsageSummary(recentModelTotals, recentModel);
      }
    }
  }

  const daily = [...dailyByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row): UsageStatsCliDailyUsage => {
      const providers = (providerDailyByDate.get(row.date) ?? []).sort(
        (a, b) => b.tokens.totalTokens - a.tokens.totalTokens
      );
      return {
        date: row.date,
        tokens: cloneTokens(row.tokens),
        cost: cloneCost(row.cost),
        displayTokens: row.tokens.totalTokens,
        providers,
        breakdown: [...row.models.entries()]
          .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
          .map(([key, tokens]): UsageStatsDailyModelUsage => {
            const { providerId, modelName, upstreamProviderId } =
              parseModelKey(key);
            return {
              name: modelName,
              providerId,
              providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
              ...(upstreamProviderId ? { upstreamProviderId } : {}),
              tokens: cloneTokens(tokens),
              cost: cloneCost(row.modelCosts.get(key) ?? createEmptyCost()),
            };
          }),
      };
    });
  const modelUsage = [...modelTotals.values()]
    .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
    .map((row) => ({
      ...row,
      share:
        totals.totalTokens > 0
          ? row.tokens.totalTokens / totals.totalTokens
          : 0,
    }));
  const recentFavoriteModel = [...recentModelTotals.values()].sort(
    (a, b) => b.tokens.totalTokens - a.tokens.totalTokens
  )[0];
  const measuredDaily = daily.filter((row) => row.displayTokens > 0);

  return {
    range: params.range,
    providers: params.providers,
    totals,
    cost,
    pricing: {
      ...getUsagePricingMetadata(params.pricingSnapshot),
      pricedTokens: cost.pricedTokens,
      unpricedTokens: cost.unpricedTokens,
    },
    daily,
    modelUsage,
    favoriteModel: modelUsage[0],
    recentFavoriteModel,
    activeDays: measuredDaily.length,
    currentStreak: computeCurrentStreak(measuredDaily, params.end),
    longestStreak: computeLongestStreak(measuredDaily),
    warnings: params.warnings,
    checkedAt: params.checkedAt,
  };
}

function buildDailyRows(
  daily: Map<string, MutableDailyUsage>,
  provider?: {
    providerId: UsageStatsCliProviderId;
    providerDisplayName: string;
  }
): UsageStatsCliDailyUsage[] {
  return [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      tokens: cloneTokens(row.tokens),
      cost: cloneCost(row.cost),
      displayTokens: row.tokens.totalTokens,
      providers: provider
        ? [
            {
              providerId: provider.providerId,
              providerDisplayName: provider.providerDisplayName,
              tokens: cloneTokens(row.tokens),
              cost: cloneCost(row.cost),
            },
          ]
        : [],
      breakdown: [...row.models.entries()]
        .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
        .map(([key, tokens]) => {
          const { modelName, upstreamProviderId } = parseUsageModelKey(key);
          return {
            name: modelName,
            providerId: provider?.providerId ?? "codex",
            providerDisplayName: provider?.providerDisplayName ?? "Codex",
            ...(upstreamProviderId ? { upstreamProviderId } : {}),
            tokens: cloneTokens(tokens),
            cost: cloneCost(row.modelCosts.get(key) ?? createEmptyCost()),
          };
        }),
    }));
}

function buildModelUsageRows(
  map: Map<string, UsageStatsTokenTotals>,
  costMap: Map<string, UsageStatsCostTotals>,
  providerId: UsageStatsCliProviderId,
  totalTokens: number
): UsageStatsModelUsage[] {
  return [...map.entries()]
    .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
    .map(([key, tokens]) => {
      const { modelName, upstreamProviderId } = parseUsageModelKey(key);
      return {
        name: modelName,
        providerId,
        providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
        ...(upstreamProviderId ? { upstreamProviderId } : {}),
        tokens: cloneTokens(tokens),
        cost: cloneCost(costMap.get(key) ?? createEmptyCost()),
        share: totalTokens > 0 ? tokens.totalTokens / totalTokens : 0,
      };
    });
}

function addModelUsageSummary(
  map: Map<string, UsageStatsModelUsage>,
  model: UsageStatsModelUsage
): void {
  const key = usageModelKey(model.name, model.upstreamProviderId);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      name: model.name,
      providerId: model.providerId,
      providerDisplayName: model.providerDisplayName,
      ...(model.upstreamProviderId
        ? { upstreamProviderId: model.upstreamProviderId }
        : {}),
      tokens: cloneTokens(model.tokens),
      cost: cloneCost(model.cost),
      share: 0,
    });
    return;
  }

  addTokens(existing.tokens, model.tokens);
  addCost(existing.cost, model.cost);
  if (existing.providerId !== model.providerId) {
    existing.providerDisplayName = "Multiple providers";
  }
}

function sumTokenMap(
  map: Map<string, UsageStatsTokenTotals>
): UsageStatsTokenTotals {
  const totals = createEmptyTokens();
  for (const tokens of map.values()) {
    addTokens(totals, tokens);
  }
  return totals;
}

async function loadAmpUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const threadsDir = path.join(getAmpDataDir(), "threads");
  if (!existsSync(threadsDir)) {
    return null;
  }

  const usage = createProviderUsage("amp", pricingSnapshot);
  const files = await listFilesRecursive(threadsDir, ".json", start.getTime());
  await runWithConcurrency(files, getFileConcurrency(), async (file) => {
    await processAmpFile(file, usage, start, end, recentStart, warnings);
  });

  return usage;
}

async function processAmpFile(
  file: string,
  usage: MutableProviderUsage,
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[]
): Promise<void> {
  let thread: AmpThread;
  try {
    thread = await readJsonDocument(file);
  } catch (error) {
    warnings.push(`Skipped Amp thread ${file}: ${sanitizeErrorMessage(error)}`);
    return;
  }

  const threadDate = thread.created ? new Date(thread.created) : null;
  let lastUserTimestamp: Date | null = null;
  for (const message of thread.messages ?? []) {
    if (message.role === "user" && message.meta?.sentAt) {
      lastUserTimestamp = new Date(message.meta.sentAt);
      continue;
    }
    processAmpAssistantMessage({
      message,
      usage,
      start,
      end,
      recentStart,
      date: lastUserTimestamp ?? threadDate,
    });
  }
}

function processAmpAssistantMessage(params: {
  message: AmpMessage;
  usage: MutableProviderUsage;
  start: Date;
  end: Date;
  recentStart: Date;
  date: Date | null;
}): void {
  const { date, message } = params;
  if (message.role !== "assistant" || !message.usage) {
    return;
  }
  if (!(date && isInRange(date, params.start, params.end))) {
    return;
  }
  const tokens = createTokens({
    input:
      (message.usage.inputTokens ?? 0) +
      (message.usage.cacheReadInputTokens ?? 0),
    output:
      (message.usage.outputTokens ?? 0) +
      (message.usage.cacheCreationInputTokens ?? 0),
    cacheInput: message.usage.cacheReadInputTokens ?? 0,
    cacheOutput: message.usage.cacheCreationInputTokens ?? 0,
  });
  recordUsage({
    usage: params.usage,
    date,
    tokens,
    modelName: normalizeModelName(message.usage.model),
    recentStart: params.recentStart,
  });
}

async function loadClaudeUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const projectDirs = getClaudeProjectDirs();
  const statsCacheFiles = getClaudeStatsCacheFiles();
  if (projectDirs.length === 0 && statsCacheFiles.length === 0) {
    return null;
  }

  const usage = createProviderUsage("claude", pricingSnapshot);
  const processedHashes = new Set<string>();
  const files = (
    await Promise.all(
      projectDirs.map((dir) =>
        listFilesRecursive(dir, ".jsonl", start.getTime())
      )
    )
  ).flat();

  await runWithConcurrency(files, getFileConcurrency(), async (file) => {
    await processClaudeLogFile(
      file,
      usage,
      start,
      end,
      recentStart,
      processedHashes,
      warnings
    );
  });

  await loadClaudeStatsCacheUsage(
    statsCacheFiles,
    start,
    end,
    recentStart,
    usage,
    warnings
  );

  return usage;
}

async function processClaudeLogFile(
  file: string,
  usage: MutableProviderUsage,
  start: Date,
  end: Date,
  recentStart: Date,
  processedHashes: Set<string>,
  warnings: string[]
): Promise<void> {
  for await (const entry of readJsonLines<ClaudeRawLogEntry>(file, warnings)) {
    processClaudeLogEntry({
      entry,
      usage,
      start,
      end,
      recentStart,
      processedHashes,
    });
  }
}

function processClaudeLogEntry(params: {
  entry: ClaudeRawLogEntry;
  usage: MutableProviderUsage;
  start: Date;
  end: Date;
  recentStart: Date;
  processedHashes: Set<string>;
}): void {
  const { entry } = params;
  if (!(entry.timestamp && entry.message?.usage)) {
    return;
  }
  const hash =
    entry.message.id && entry.requestId
      ? `${entry.message.id}:${entry.requestId}`
      : null;
  if (hash && params.processedHashes.has(hash)) {
    return;
  }
  if (hash) {
    params.processedHashes.add(hash);
  }
  const date = new Date(entry.timestamp);
  if (!isInRange(date, params.start, params.end)) {
    return;
  }
  const cacheInput = entry.message.usage.cache_read_input_tokens ?? 0;
  const cacheOutput = entry.message.usage.cache_creation_input_tokens ?? 0;
  const tokens = createTokens({
    input: (entry.message.usage.input_tokens ?? 0) + cacheInput,
    output: (entry.message.usage.output_tokens ?? 0) + cacheOutput,
    cacheInput,
    cacheOutput,
  });
  recordUsage({
    usage: params.usage,
    date,
    tokens,
    modelName:
      entry.message.model && entry.message.model !== "<synthetic>"
        ? normalizeModelName(entry.message.model)
        : undefined,
    upstreamProviderId: "anthropic",
    recentStart: params.recentStart,
  });
}

async function loadClaudeStatsCacheUsage(
  files: string[],
  start: Date,
  end: Date,
  recentStart: Date,
  usage: MutableProviderUsage,
  warnings: string[]
): Promise<void> {
  const coveredDates = new Set(usage.daily.keys());
  for (const file of files) {
    let statsCache: {
      dailyModelTokens?: Array<{
        date?: string;
        tokensByModel?: Record<string, number>;
      }>;
    };
    try {
      statsCache = await readJsonDocument(file);
    } catch (error) {
      warnings.push(
        `Skipped Claude stats cache ${file}: ${sanitizeErrorMessage(error)}`
      );
      continue;
    }

    for (const row of statsCache.dailyModelTokens ?? []) {
      if (!row.date || coveredDates.has(row.date)) {
        continue;
      }
      const date = new Date(`${row.date}T00:00:00`);
      if (!isInRange(date, start, end)) {
        continue;
      }
      for (const [modelName, rawTotal] of Object.entries(
        row.tokensByModel ?? {}
      )) {
        const total = Math.max(0, Math.round(rawTotal));
        if (total <= 0) {
          continue;
        }
        recordUsage({
          usage,
          date,
          tokens: {
            inputTokens: total,
            outputTokens: 0,
            cacheInputTokens: 0,
            cacheOutputTokens: 0,
            totalTokens: total,
          },
          modelName: normalizeModelName(modelName),
          upstreamProviderId: "anthropic",
          recentStart,
        });
      }
    }
  }
}

async function loadCodexUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot,
  usageIndex: CodexUsageIndex
): Promise<MutableProviderUsage | null> {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const usage = createProviderUsage("codex", pricingSnapshot);
  const files = await listFilesRecursive(
    sessionsDir,
    ".jsonl",
    start.getTime()
  );
  await runWithConcurrency(files, getFileConcurrency(), async (file) => {
    await processCodexFile(
      file,
      start,
      end,
      recentStart,
      usage,
      warnings,
      usageIndex
    );
  });
  await usageIndex.flush();
  return usage;
}

async function processCodexFile(
  file: string,
  start: Date,
  end: Date,
  recentStart: Date,
  usage: MutableProviderUsage,
  warnings: string[],
  usageIndex: CodexUsageIndex
): Promise<void> {
  const events = await usageIndex.getEvents(file, warnings);
  for (const event of events) {
    const date = new Date(event.atMs);
    if (!isInRange(date, start, end)) {
      continue;
    }
    recordUsage({
      usage,
      date,
      tokens: event.tokens,
      modelName: event.modelName,
      upstreamProviderId: "openai",
      recentStart,
    });
  }
}

async function readCodexIndexedEvents(
  file: string,
  warnings: string[]
): Promise<CodexIndexedUsageEvent[]> {
  let previousTotals: NormalizedCodexUsage | null = null;
  const modelContext: CodexFileModelContext = {
    isSubagentSession: await isCodexSubagentLog(file),
    explicitModels: new Set(),
  };
  const events: CodexIndexedUsageEvent[] = [];

  for await (const entry of readJsonLines<CodexJsonlEntry>(
    file,
    warnings,
    CODEX_RELEVANT_JSONL_MARKERS
  )) {
    const extractedModel = extractCodexModel(entry.payload);

    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
      updateCodexModelContext(modelContext, entry, extractedModel);
      continue;
    }

    const totalUsage = normalizeCodexUsage(
      entry.payload.info?.total_token_usage
    );
    const lastUsage = normalizeCodexUsage(entry.payload.info?.last_token_usage);
    let rawUsage: NormalizedCodexUsage | null = null;

    if (totalUsage) {
      rawUsage = didCodexTotalsRollback(totalUsage, previousTotals)
        ? (lastUsage ?? totalUsage)
        : subtractCodexUsage(totalUsage, previousTotals);
      previousTotals = totalUsage;
    } else if (lastUsage) {
      rawUsage = lastUsage;
      previousTotals = addCodexUsage(previousTotals, lastUsage);
    }

    if (!(rawUsage && entry.timestamp)) {
      continue;
    }

    const date = new Date(entry.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const normalizedModelName =
      normalizeModelName(extractedModel) ?? modelContext.currentModel;
    events.push({
      atMs: date.getTime(),
      tokens: {
        inputTokens: rawUsage.inputTokens,
        outputTokens: rawUsage.outputTokens,
        cacheInputTokens: rawUsage.cachedInputTokens,
        cacheOutputTokens: 0,
        totalTokens: rawUsage.totalTokens,
      },
      ...(normalizedModelName ? { modelName: normalizedModelName } : {}),
    });
  }
  return backfillCodexSubagentModel(events, modelContext);
}

function updateCodexModelContext(
  context: CodexFileModelContext,
  entry: CodexJsonlEntry,
  extractedModel: string | undefined
): void {
  if (entry.type !== "turn_context") {
    return;
  }
  const normalizedModel = normalizeModelName(extractedModel);
  if (normalizedModel) {
    context.currentModel = normalizedModel;
    context.explicitModels.add(normalizedModel);
  }
}

async function isCodexSubagentLog(file: string): Promise<boolean> {
  const source = bunFile(file);
  const prefix = await source
    .slice(0, Math.min(source.size, CODEX_SESSION_META_PREFIX_BYTES))
    .text();
  const firstLineEnd = prefix.indexOf("\n");
  const sessionMeta =
    firstLineEnd >= 0 ? prefix.slice(0, firstLineEnd) : prefix;
  return (
    CODEX_SUBAGENT_THREAD_SOURCE_RE.test(sessionMeta) ||
    CODEX_SUBAGENT_SOURCE_RE.test(sessionMeta)
  );
}

function backfillCodexSubagentModel(
  events: CodexIndexedUsageEvent[],
  context: CodexFileModelContext
): CodexIndexedUsageEvent[] {
  const soleExplicitModel =
    context.explicitModels.size === 1
      ? context.explicitModels.values().next().value
      : undefined;
  if (!(context.isSubagentSession && soleExplicitModel)) {
    return events;
  }
  return events.map((event) =>
    event.modelName ? event : { ...event, modelName: soleExplicitModel }
  );
}

function isCodexFileIndexEntry(value: unknown): value is CodexFileIndexEntry {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const entry = value as Partial<CodexFileIndexEntry>;
  return (
    isNonNegativeFiniteNumber(entry.size) &&
    isNonNegativeFiniteNumber(entry.lastModified) &&
    Array.isArray(entry.events) &&
    entry.events.every(isCodexIndexedUsageEvent)
  );
}

function isCodexIndexedUsageEvent(
  value: unknown
): value is CodexIndexedUsageEvent {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const event = value as Partial<CodexIndexedUsageEvent>;
  const tokens = event.tokens;
  return (
    isNonNegativeFiniteNumber(event.atMs) &&
    (event.modelName === undefined || typeof event.modelName === "string") &&
    Boolean(tokens) &&
    isNonNegativeFiniteNumber(tokens?.inputTokens) &&
    isNonNegativeFiniteNumber(tokens?.outputTokens) &&
    isNonNegativeFiniteNumber(tokens?.cacheInputTokens) &&
    isNonNegativeFiniteNumber(tokens?.cacheOutputTokens) &&
    isNonNegativeFiniteNumber(tokens?.totalTokens)
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function loadCursorUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const databasePath = getCursorStateDbPath();
  if (!databasePath) {
    return null;
  }

  const accessToken = await readCursorAccessToken(databasePath);
  if (!accessToken) {
    return createProviderUsage("cursor", pricingSnapshot);
  }

  const csvText = await fetchCursorUsageCsv(accessToken);
  const usage = createProviderUsage("cursor", pricingSnapshot);
  processCursorCsvText(csvText, (row) => {
    const date = parseCursorDate(row.Date);
    const modelName = normalizeModelName(row.Model);
    const tokens = createCursorTokenTotals(row);
    if (!(date && tokens && modelName && isInRange(date, start, end))) {
      return;
    }
    recordUsage({ usage, date, tokens, modelName, recentStart });
  });
  return usage;
}

async function loadGeminiUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const tmpDir = path.join(getGeminiBaseDir(), "tmp");
  if (!existsSync(tmpDir)) {
    return null;
  }

  const usage = createProviderUsage("gemini", pricingSnapshot);
  const files = (
    await listFilesRecursive(tmpDir, ".json", start.getTime())
  ).filter((file) => GEMINI_SESSION_FILE_RE.test(file));
  const dedupe = new Set<string>();

  for (const file of files) {
    let session: {
      sessionId?: string;
      messages?: Array<{
        id?: string;
        timestamp?: string;
        type?: string;
        model?: string;
        tokens?: {
          input?: number;
          output?: number;
          cached?: number;
          thoughts?: number;
          tool?: number;
        };
      }>;
    };
    try {
      session = await readJsonDocument(file);
    } catch (error) {
      warnings.push(
        `Skipped Gemini session ${file}: ${sanitizeErrorMessage(error)}`
      );
      continue;
    }
    for (const message of session.messages ?? []) {
      if (message.type !== "gemini" || !message.tokens || !message.timestamp) {
        continue;
      }
      const key = JSON.stringify({
        sessionId: session.sessionId,
        id: message.id,
        timestamp: message.timestamp,
        model: message.model,
        tokens: message.tokens,
      });
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);
      const date = new Date(message.timestamp);
      if (!isInRange(date, start, end)) {
        continue;
      }
      const cacheInput = message.tokens.cached ?? 0;
      const tokens = createTokens({
        input: (message.tokens.input ?? 0) + cacheInput,
        output:
          (message.tokens.output ?? 0) +
          (message.tokens.thoughts ?? 0) +
          (message.tokens.tool ?? 0),
        cacheInput,
        cacheOutput: 0,
      });
      recordUsage({
        usage,
        date,
        tokens,
        modelName: normalizeModelName(message.model),
        upstreamProviderId: "google",
        recentStart,
      });
    }
  }

  return usage;
}

async function loadOpenCodeUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const baseDir = getOpenCodeBaseDir();
  const databasePath = path.join(baseDir, "opencode.db");
  const legacyMessagesDir = path.join(baseDir, "storage", "message");
  if (!(existsSync(databasePath) || existsSync(legacyMessagesDir))) {
    return null;
  }

  const usage = createProviderUsage("opencode", pricingSnapshot);
  const dedupe = new Set<string>();
  const addMessage = (message: {
    id?: string;
    role?: string;
    modelID?: string;
    providerID?: string;
    time?: { created?: number };
    tokens?: {
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
  }) => {
    if (!message.id || dedupe.has(message.id)) {
      return;
    }
    dedupe.add(message.id);
    if (
      message.role !== "assistant" ||
      !message.tokens ||
      !message.time?.created
    ) {
      return;
    }
    const date = new Date(message.time.created);
    if (!isInRange(date, start, end)) {
      return;
    }
    const cacheInput = message.tokens.cache?.read ?? 0;
    const cacheOutput = message.tokens.cache?.write ?? 0;
    const tokens = createTokens({
      input: (message.tokens.input ?? 0) + cacheInput,
      output: (message.tokens.output ?? 0) + cacheOutput,
      cacheInput,
      cacheOutput,
    });
    recordUsage({
      usage,
      date,
      tokens,
      modelName: normalizeModelName(message.modelID),
      upstreamProviderId: message.providerID,
      recentStart,
    });
  };

  if (existsSync(databasePath)) {
    await withReadonlySqlite(databasePath, (db) => {
      const statement = db.query(`
        SELECT id, data
        FROM message
        WHERE time_created >= $startMs
          AND time_created <= $endMs
        ORDER BY time_created ASC
      `);
      for (const row of statement.iterate({
        $startMs: start.getTime(),
        $endMs: end.getTime(),
      }) as Iterable<{
        id?: string;
        data?: string;
      }>) {
        if (typeof row.data !== "string") {
          continue;
        }
        const message = parseJsonTextWithLimit<Record<string, unknown>>(
          row.data,
          `${databasePath}:message:${row.id ?? "unknown"}`
        ) as Parameters<typeof addMessage>[0];
        addMessage({ ...message, id: message.id ?? row.id });
      }
    });
    return usage;
  }

  const files = await listFilesRecursive(
    legacyMessagesDir,
    ".json",
    start.getTime()
  );
  for (const file of files) {
    try {
      addMessage(await readJsonDocument(file));
    } catch (error) {
      warnings.push(
        `Skipped OpenCode message ${file}: ${sanitizeErrorMessage(error)}`
      );
    }
  }

  return usage;
}

async function loadPiUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  warnings: string[],
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const sessionsDir = path.join(getPiAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const usage = createProviderUsage("pi", pricingSnapshot);
  const files = await listFilesRecursive(
    sessionsDir,
    ".jsonl",
    start.getTime()
  );
  for (const file of files) {
    for await (const entry of readJsonLines<{
      type?: string;
      timestamp?: string;
      message?: {
        role?: string;
        model?: string;
        timestamp?: string | number;
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          totalTokens?: number;
        };
      };
    }>(file, warnings)) {
      if (entry.type !== "message" || entry.message?.role !== "assistant") {
        continue;
      }
      const rawTimestamp = entry.timestamp ?? entry.message.timestamp;
      const date =
        typeof rawTimestamp === "number" || typeof rawTimestamp === "string"
          ? new Date(rawTimestamp)
          : null;
      if (!(date && entry.message.usage && isInRange(date, start, end))) {
        continue;
      }
      const cacheInput = entry.message.usage.cacheRead ?? 0;
      const cacheOutput = entry.message.usage.cacheWrite ?? 0;
      const input = (entry.message.usage.input ?? 0) + cacheInput;
      const output = (entry.message.usage.output ?? 0) + cacheOutput;
      recordUsage({
        usage,
        date,
        tokens: {
          inputTokens: input,
          outputTokens: output,
          cacheInputTokens: cacheInput,
          cacheOutputTokens: cacheOutput,
          totalTokens: entry.message.usage.totalTokens ?? input + output,
        },
        modelName: normalizeModelName(entry.message.model),
        recentStart,
      });
    }
  }

  return usage;
}

async function loadZcodeUsage(
  start: Date,
  end: Date,
  recentStart: Date,
  pricingSnapshot: PricingSnapshot
): Promise<MutableProviderUsage | null> {
  const databasePath = getZcodeDatabasePath();
  if (!databasePath) {
    return null;
  }

  const usage = createProviderUsage("zcode", pricingSnapshot);
  await withReadonlySqlite(databasePath, (db) => {
    const statement = db.query(
      `SELECT
        id,
        provider_id,
        model_id,
        status,
        started_at,
        completed_at,
        input_tokens,
        output_tokens,
        reasoning_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        computed_total_tokens,
        provider_total_tokens
      FROM model_usage
      WHERE COALESCE(completed_at, started_at) >= $startMs
        AND COALESCE(completed_at, started_at) <= $endMs
      ORDER BY COALESCE(completed_at, started_at) ASC`
    );
    for (const row of statement.iterate({
      $startMs: start.getTime(),
      $endMs: end.getTime(),
    }) as Iterable<ZcodeModelUsageRow>) {
      const date = createZcodeUsageDate(row);
      const tokens = createZcodeTokenTotals(row);
      if (!(date && tokens && isInRange(date, start, end))) {
        continue;
      }
      recordUsage({
        usage,
        date,
        tokens,
        modelName: normalizeZcodeModelName(row.provider_id, row.model_id),
        upstreamProviderId: row.provider_id,
        recentStart,
      });
    }
  });

  return usage;
}

function getAmpDataDir(): string {
  const envDir = process.env.AMP_DATA_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  const xdgDataHome =
    process.env.XDG_DATA_HOME?.trim() ||
    path.join(homedir(), ".local", "share");
  return path.join(xdgDataHome, "amp");
}

function getClaudeConfigPaths(): string[] {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
  const envPaths = parsePathList(process.env.CLAUDE_CONFIG_DIR).map((value) =>
    path.resolve(value)
  );
  const paths = [
    ...envPaths,
    path.join(xdgConfigHome, "claude"),
    path.join(homedir(), ".claude"),
    ...discoverClaudeWorkDirs(),
  ];
  return uniqueExistingOrConfiguredPaths(paths);
}

function discoverClaudeWorkDirs(): string[] {
  try {
    return readdirSyncSafe(homedir())
      .filter((entry) => entry.name.startsWith(".claude-"))
      .map((entry) => path.join(homedir(), entry.name))
      .filter(
        (dir) =>
          existsSync(path.join(dir, "projects")) ||
          existsSync(path.join(dir, "stats-cache.json"))
      );
  } catch {
    return [];
  }
}

function getClaudeProjectDirs(): string[] {
  return getClaudeConfigPaths()
    .map((base) => path.join(base, "projects"))
    .filter((dir) => existsSync(dir));
}

function getClaudeStatsCacheFiles(): string[] {
  return getClaudeConfigPaths()
    .map((base) => path.join(base, "stats-cache.json"))
    .filter((file) => existsSync(file));
}

function getCodexHome(): string {
  return process.env.CODEX_HOME?.trim()
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(homedir(), ".codex");
}

function getGeminiBaseDir(): string {
  return process.env.GEMINI_CONFIG_DIR?.trim()
    ? path.resolve(process.env.GEMINI_CONFIG_DIR)
    : path.join(homedir(), ".gemini");
}

function getOpenCodeBaseDir(): string {
  if (process.env.OPENCODE_DATA_DIR?.trim()) {
    return path.resolve(process.env.OPENCODE_DATA_DIR);
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA?.trim() ||
        path.join(homedir(), "AppData", "Local"),
      "opencode"
    );
  }
  return path.join(homedir(), ".local", "share", "opencode");
}

function getPiAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim()
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : path.join(homedir(), ".pi", "agent");
}

function getZcodeDatabasePath(): string | null {
  const explicit = process.env.ZCODE_DB_PATH?.trim();
  if (explicit && existsSync(path.resolve(explicit))) {
    return path.resolve(explicit);
  }

  const databasePath = path.join(getZcodeCliDir(), "db", "db.sqlite");
  return existsSync(databasePath) ? databasePath : null;
}

function getZcodeCliDir(): string {
  const explicit = process.env.ZCODE_CLI_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const zcodeHome = path.join(homedir(), ".zcode");
  const candidates = [
    path.join(zcodeHome, "cli"),
    path.join(zcodeHome, "clil"),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    path.join(zcodeHome, "cli")
  );
}

function getCursorStateDbPath(): string | null {
  const explicit = process.env.CURSOR_STATE_DB_PATH?.trim();
  if (explicit && existsSync(path.resolve(explicit))) {
    return path.resolve(explicit);
  }

  const configured = parsePathList(process.env.CURSOR_CONFIG_DIR).map(
    (value) => {
      const resolved = path.resolve(value);
      return resolved.endsWith(".vscdb")
        ? resolved
        : path.join(resolved, "User", "globalStorage", "state.vscdb");
    }
  );
  const candidates = configured.length
    ? configured
    : [getDefaultCursorStateDbPath()];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getDefaultCursorStateDbPath(): string {
  const relative = path.join("User", "globalStorage", "state.vscdb");
  if (process.platform === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      relative
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA?.trim() || path.join(homedir(), "AppData", "Roaming"),
      "Cursor",
      relative
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config"),
    "Cursor",
    relative
  );
}

async function readCursorAccessToken(
  databasePath: string
): Promise<string | null> {
  return await withReadonlySqlite(databasePath, (db) => {
    const row = db
      .query("SELECT value FROM ItemTable WHERE key = ? LIMIT 1")
      .get("cursorAuth/accessToken") as { value?: unknown } | null;
    const token = normalizeDbText(row?.value);
    return token ?? null;
  });
}

async function fetchCursorUsageCsv(accessToken: string): Promise<string> {
  const url = new URL(
    "/api/dashboard/export-usage-events-csv?strategy=tokens",
    (process.env.CURSOR_WEB_BASE_URL?.trim() || "https://cursor.com").replace(
      CURSOR_WEB_BASE_TRAILING_SLASH_RE,
      ""
    )
  );
  const attempts = getCursorFetchAttempts(accessToken);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    for (const headers of attempts) {
      const response = await fetch(url, {
        headers: {
          Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
          ...headers,
        },
        signal: controller.signal,
      });
      if (response.ok) {
        return await response.text();
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new Error("Cursor usage export rejected local auth state");
}

function getCursorFetchAttempts(accessToken: string): Record<string, string>[] {
  const cookieName = "WorkosCursorSessionToken";
  const subject = decodeJwtSubject(accessToken);
  const cookieValues = subject
    ? [accessToken, `${subject}::${accessToken}`]
    : [accessToken];
  const attempts: Record<string, string>[] = [
    { Authorization: `Bearer ${accessToken}` },
  ];

  for (const cookieValue of cookieValues) {
    attempts.push({ Cookie: `${cookieName}=${cookieValue}` });
    attempts.push({
      Cookie: `${cookieName}=${encodeURIComponent(cookieValue)}`,
    });
    attempts.push({
      Authorization: `Bearer ${accessToken}`,
      Cookie: `${cookieName}=${cookieValue}`,
    });
  }

  return attempts;
}

function decodeJwtSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const parsed = JSON.parse(
      Buffer.from(
        base64.padEnd(Math.ceil(base64.length / 4) * 4, "="),
        "base64"
      ).toString("utf8")
    ) as { sub?: string };
    return parsed.sub?.trim() || null;
  } catch {
    return null;
  }
}

function processCursorCsvText(
  content: string,
  onRow: (row: CursorCsvRow) => void
): void {
  let headers: string[] | null = null;
  for (const rawLine of content.split(CSV_LINE_RE)) {
    if (!rawLine.trim()) {
      continue;
    }
    const values = parseCsvLine(rawLine);
    if (!headers) {
      headers = values;
      continue;
    }
    const row: CursorCsvRow = {};
    headers.forEach((header, index) => {
      row[header as keyof CursorCsvRow] = values[index];
    });
    onRow(row);
  }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCursorDate(value?: string): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const date = ISO_DATE_ONLY_RE.test(trimmed)
    ? new Date(`${trimmed}T00:00:00`)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createCursorTokenTotals(
  row: CursorCsvRow
): UsageStatsTokenTotals | null {
  const total =
    parseCursorNumber(row["Total Tokens"]) ?? parseCursorNumber(row.Tokens);
  if (!total) {
    return null;
  }
  const inputWithCacheWrite =
    parseCursorNumber(row["Input (w/ Cache Write)"]) ?? 0;
  const inputWithoutCacheWrite =
    parseCursorNumber(row["Input (w/o Cache Write)"]) ?? 0;
  const cacheInput = parseCursorNumber(row["Cache Read"]) ?? 0;
  const output = parseCursorNumber(row["Output Tokens"]) ?? 0;
  return {
    inputTokens: inputWithCacheWrite + inputWithoutCacheWrite + cacheInput,
    outputTokens: output,
    cacheInputTokens: cacheInput,
    cacheOutputTokens: inputWithCacheWrite,
    totalTokens: total,
  };
}

function parseCursorNumber(value?: string): number | null {
  const parsed = Number(value?.replaceAll(",", "").trim() ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

async function withReadonlySqlite<T>(
  databasePath: string,
  callback: (db: Database) => T
): Promise<T> {
  try {
    return runReadonlySqlite(databasePath, callback);
  } catch (error) {
    if (!isSqliteLockedError(error)) {
      throw error;
    }
    return await withDatabaseSnapshot(databasePath, (snapshotPath) =>
      runReadonlySqlite(snapshotPath, callback)
    );
  }
}

function runReadonlySqlite<T>(
  databasePath: string,
  callback: (db: Database) => T
): T {
  const db = new Database(databasePath, { readonly: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

async function withDatabaseSnapshot<T>(
  databasePath: string,
  callback: (snapshotPath: string) => T
): Promise<T> {
  const snapshotDir = await mkdtemp(
    path.join(tmpdir(), "eragear-usage-sqlite-")
  );
  const snapshotPath = path.join(snapshotDir, path.basename(databasePath));

  await copyFile(databasePath, snapshotPath);
  for (const suffix of ["-shm", "-wal"]) {
    const companion = `${databasePath}${suffix}`;
    if (existsSync(companion)) {
      await copyFile(companion, `${snapshotPath}${suffix}`);
    }
  }

  try {
    return callback(snapshotPath);
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
}

function isSqliteLockedError(error: unknown): boolean {
  return error instanceof Error && SQLITE_LOCKED_RE.test(error.message);
}

function normalizeDbText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim() || undefined;
  }
  return undefined;
}

function normalizeCodexUsage(
  value?: CodexUsagePayload
): NormalizedCodexUsage | null {
  if (!value) {
    return null;
  }
  const inputTokens = value.input_tokens ?? 0;
  const cachedInputTokens =
    value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  const outputTokens = value.output_tokens ?? 0;
  const reasoningOutputTokens = value.reasoning_output_tokens ?? 0;
  const totalTokens = value.total_tokens ?? inputTokens + outputTokens;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function addCodexUsage(
  base: NormalizedCodexUsage | null,
  delta: NormalizedCodexUsage
): NormalizedCodexUsage {
  return {
    inputTokens: (base?.inputTokens ?? 0) + delta.inputTokens,
    cachedInputTokens: (base?.cachedInputTokens ?? 0) + delta.cachedInputTokens,
    outputTokens: (base?.outputTokens ?? 0) + delta.outputTokens,
    reasoningOutputTokens:
      (base?.reasoningOutputTokens ?? 0) + delta.reasoningOutputTokens,
    totalTokens: (base?.totalTokens ?? 0) + delta.totalTokens,
  };
}

function subtractCodexUsage(
  current: NormalizedCodexUsage,
  previous: NormalizedCodexUsage | null
): NormalizedCodexUsage {
  return {
    inputTokens: Math.max(
      current.inputTokens - (previous?.inputTokens ?? 0),
      0
    ),
    cachedInputTokens: Math.max(
      current.cachedInputTokens - (previous?.cachedInputTokens ?? 0),
      0
    ),
    outputTokens: Math.max(
      current.outputTokens - (previous?.outputTokens ?? 0),
      0
    ),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0),
      0
    ),
    totalTokens: Math.max(
      current.totalTokens - (previous?.totalTokens ?? 0),
      0
    ),
  };
}

function didCodexTotalsRollback(
  current: NormalizedCodexUsage,
  previous: NormalizedCodexUsage | null
): boolean {
  if (!previous) {
    return false;
  }
  return (
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningOutputTokens < previous.reasoningOutputTokens ||
    current.totalTokens < previous.totalTokens
  );
}

function extractCodexModel(payload?: {
  model?: string;
  model_name?: string;
  metadata?: { model?: string };
  info?: {
    model?: string;
    model_name?: string;
    metadata?: { model?: string };
  };
}): string | undefined {
  return (
    asNonEmptyString(payload?.model) ??
    asNonEmptyString(payload?.model_name) ??
    asNonEmptyString(payload?.metadata?.model) ??
    asNonEmptyString(payload?.info?.model) ??
    asNonEmptyString(payload?.info?.model_name) ??
    asNonEmptyString(payload?.info?.metadata?.model)
  );
}

function createTokens(input: {
  input: number;
  output: number;
  cacheInput: number;
  cacheOutput: number;
}): UsageStatsTokenTotals {
  return {
    inputTokens: Math.max(0, Math.round(input.input)),
    outputTokens: Math.max(0, Math.round(input.output)),
    cacheInputTokens: Math.max(0, Math.round(input.cacheInput)),
    cacheOutputTokens: Math.max(0, Math.round(input.cacheOutput)),
    totalTokens: Math.max(0, Math.round(input.input + input.output)),
  };
}

function createZcodeUsageDate(row: ZcodeModelUsageRow): Date | null {
  const timestamp = row.completed_at ?? row.started_at;
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp)
    : null;
}

function createZcodeTokenTotals(
  row: ZcodeModelUsageRow
): UsageStatsTokenTotals | null {
  const rawInput = nonNegativeInteger(row.input_tokens);
  const rawOutput = nonNegativeInteger(row.output_tokens);
  const reasoning = nonNegativeInteger(row.reasoning_tokens);
  const cacheInput = nonNegativeInteger(row.cache_read_input_tokens);
  const cacheOutput = nonNegativeInteger(row.cache_creation_input_tokens);
  const outputTokens = rawOutput + reasoning + cacheOutput;
  const fallbackTotal =
    rawInput + rawOutput + reasoning + cacheInput + cacheOutput;
  const totalTokens =
    nonNegativeInteger(row.computed_total_tokens) ||
    nonNegativeInteger(row.provider_total_tokens) ||
    fallbackTotal;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    inputTokens: Math.max(0, totalTokens - outputTokens),
    outputTokens,
    cacheInputTokens: Math.min(cacheInput, totalTokens),
    cacheOutputTokens: Math.min(cacheOutput, totalTokens),
    totalTokens,
  };
}

function normalizeZcodeModelName(
  providerId?: string,
  modelId?: string
): string | undefined {
  const model = normalizeZcodeProviderHint(normalizeModelName(modelId));
  if (!model) {
    return undefined;
  }
  if (model.includes("/")) {
    return model;
  }

  const provider = normalizeZcodeProviderHint(providerId);
  return provider ? `${provider}/${model}` : model;
}

function normalizeZcodeProviderHint(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("builtin:")
    ? normalized.slice("builtin:".length)
    : normalized;
}

function nonNegativeInteger(value?: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

async function listFilesRecursive(
  rootDir: string,
  extension: string,
  modifiedSinceMs?: number
): Promise<string[]> {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Dirent<string>[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(extension)) {
        const source = bunFile(fullPath);
        if (
          modifiedSinceMs === undefined ||
          source.lastModified <= 0 ||
          source.lastModified >= modifiedSinceMs
        ) {
          files.push(fullPath);
        }
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function* readJsonLines<T>(
  file: string,
  warnings: string[],
  requiredMarkers?: readonly string[]
): AsyncGenerator<T> {
  const maxBytes = getMaxJsonRecordBytes();
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;

  for await (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (
      requiredMarkers &&
      !requiredMarkers.some((marker) => line.includes(marker))
    ) {
      continue;
    }
    if (Buffer.byteLength(line, "utf8") > maxBytes) {
      warnings.push(
        `Skipped oversized JSONL record in ${file}:${lineNumber}; ${MAX_JSON_RECORD_BYTES_ENV}=${maxBytes}`
      );
      continue;
    }
    try {
      yield JSON.parse(line) as T;
    } catch {
      // Preserve CLI log scanning tolerance for partial or malformed rows.
    }
  }
}

async function readJsonDocument<T>(file: string): Promise<T> {
  const maxBytes = getMaxJsonRecordBytes();
  const source = bunFile(file);
  if (source.size > maxBytes) {
    throw new Error(
      `JSON document exceeds ${maxBytes} bytes. Increase ${MAX_JSON_RECORD_BYTES_ENV} to process it.`
    );
  }
  return parseJsonTextWithLimit<T>(await source.text(), file);
}

function parseJsonTextWithLimit<T>(content: string, label: string): T {
  const maxBytes = getMaxJsonRecordBytes();
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error(
      `JSON payload exceeds ${maxBytes} bytes in ${label}. Increase ${MAX_JSON_RECORD_BYTES_ENV} to process it.`
    );
  }
  return JSON.parse(content) as T;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        const item = items[index];
        if (item === undefined) {
          continue;
        }
        await worker(item, index);
      }
    })
  );
}

function getFileConcurrency(): number {
  return getPositiveIntegerEnv(
    FILE_PROCESS_CONCURRENCY_ENV,
    DEFAULT_FILE_PROCESS_CONCURRENCY
  );
}

function getMaxJsonRecordBytes(): number {
  return getPositiveIntegerEnv(
    MAX_JSON_RECORD_BYTES_ENV,
    DEFAULT_MAX_JSON_RECORD_BYTES
  );
}

async function withProviderScanTimeout<T>(
  providerId: UsageStatsCliProviderId,
  operation: Promise<T>
): Promise<T> {
  const timeoutMs = getProviderScanTimeoutMs(providerId);
  let timeout: Timer | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `${PROVIDER_DISPLAY_NAMES[providerId]} scan timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getProviderScanTimeoutMs(providerId: UsageStatsCliProviderId): number {
  return getPositiveIntegerEnv(
    PROVIDER_SCAN_TIMEOUT_MS_ENV,
    DEFAULT_PROVIDER_SCAN_TIMEOUT_MS[providerId]
  );
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePathList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueExistingOrConfiguredPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const rawPath of paths) {
    const resolved = path.resolve(rawPath);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function readdirSyncSafe(dir: string): { name: string }[] {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRecentWindowStart(end: Date): Date {
  const recent = new Date(end);
  recent.setDate(recent.getDate() - 29);
  recent.setHours(0, 0, 0, 0);
  return recent;
}

function isInRange(date: Date, start: Date, end: Date): boolean {
  return !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

function normalizeModelName(value?: string): string | undefined {
  const normalized = value?.trim().replace(MODEL_DATE_SUFFIX_RE, "");
  return normalized || undefined;
}

function normalizeModelUsageName(value?: string): string | undefined {
  const normalized = normalizeModelName(value);
  if (!normalized) {
    return undefined;
  }
  const lastSlash = normalized.lastIndexOf("/");
  const modelName =
    lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const displayName = modelName.trim().replace(MODEL_DATE_SUFFIX_RE, "");
  return displayName ? displayName.toLowerCase() : undefined;
}

function asNonEmptyString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function modelKey(
  providerId: UsageStatsCliProviderId,
  modelName: string,
  upstreamProviderId?: string
): string {
  return `${providerId}\u0000${upstreamProviderId ?? ""}\u0000${modelName}`;
}

function parseModelKey(key: string): {
  providerId: UsageStatsCliProviderId;
  modelName: string;
  upstreamProviderId?: string;
} {
  const [providerId, upstreamProviderId, ...modelParts] = key.split("\u0000");
  return {
    providerId: providerId as UsageStatsCliProviderId,
    modelName: modelParts.join("\u0000"),
    ...(upstreamProviderId ? { upstreamProviderId } : {}),
  };
}

function usageModelKey(modelName: string, upstreamProviderId?: string): string {
  return `${upstreamProviderId ?? ""}\u0000${modelName}`;
}

function parseUsageModelKey(key: string): {
  modelName: string;
  upstreamProviderId?: string;
} {
  const [upstreamProviderId, ...modelParts] = key.split("\u0000");
  return {
    modelName: modelParts.join("\u0000"),
    ...(upstreamProviderId ? { upstreamProviderId } : {}),
  };
}

function normalizeUpstreamProviderId(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("minimax")) {
    return "minimax-coding-plan";
  }
  if (
    normalized.includes("zai") ||
    normalized.includes("z.ai") ||
    normalized.includes("z-code")
  ) {
    return "zai";
  }
  if (
    normalized.includes("openai") ||
    normalized.includes("chatgpt") ||
    normalized === "codex"
  ) {
    return "openai";
  }
  if (normalized.includes("anthropic") || normalized === "claude") {
    return "anthropic";
  }
  if (normalized.includes("google") || normalized === "gemini") {
    return "google";
  }
  return normalized.replace(BUILTIN_PROVIDER_PREFIX_RE, "");
}

function computeLongestStreak(daily: UsageStatsCliDailyUsage[]): number {
  if (daily.length === 0) {
    return 0;
  }
  let longest = 1;
  let running = 1;
  for (let index = 1; index < daily.length; index += 1) {
    const previous = daily[index - 1];
    const current = daily[index];
    if (
      previous &&
      current &&
      isConsecutiveDateKey(previous.date, current.date)
    ) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 1;
    }
  }
  return longest;
}

function computeCurrentStreak(
  daily: UsageStatsCliDailyUsage[],
  end: Date
): number {
  if (daily.length === 0) {
    return 0;
  }
  const endKey = formatLocalDate(end);
  const yesterday = new Date(end);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatLocalDate(yesterday);
  const last = daily.at(-1);
  if (!last || (last.date !== endKey && last.date !== yesterdayKey)) {
    return 0;
  }
  let current = 1;
  for (let index = daily.length - 2; index >= 0; index -= 1) {
    const previous = daily[index];
    const next = daily[index + 1];
    if (!(previous && next && isConsecutiveDateKey(previous.date, next.date))) {
      break;
    }
    current += 1;
  }
  return current;
}

function isConsecutiveDateKey(left: string, right: string): boolean {
  return dateKeyToMs(right) - dateKeyToMs(left) === DAY_MS;
}

function dateKeyToMs(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.message.replace(BEARER_TOKEN_RE, "Bearer [redacted]");
}
