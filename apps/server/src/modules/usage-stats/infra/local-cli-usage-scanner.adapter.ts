import { Database } from "bun:sqlite";
import {
  createReadStream,
  type Dirent,
  existsSync,
  readdirSync,
} from "node:fs";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
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
} from "./usage-pricing";

const CLI_PROVIDER_IDS: UsageStatsCliProviderId[] = [
  "amp",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
];

const PROVIDER_DISPLAY_NAMES: Record<UsageStatsCliProviderId, string> = {
  amp: "Amp",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  pi: "Pi Coding Agent",
};

const FILE_PROCESS_CONCURRENCY_ENV = "SLOPMETER_FILE_PROCESS_CONCURRENCY";
const MAX_JSON_RECORD_BYTES_ENV = "SLOPMETER_MAX_JSONL_RECORD_BYTES";
const PROVIDER_SCAN_TIMEOUT_MS_ENV = "SLOPMETER_PROVIDER_SCAN_TIMEOUT_MS";
const DEFAULT_FILE_PROCESS_CONCURRENCY = 16;
const DEFAULT_MAX_JSON_RECORD_BYTES = 64 * 1024 * 1024;
const DEFAULT_PROVIDER_SCAN_TIMEOUT_MS = 12_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const GEMINI_SESSION_FILE_RE = /[\\/]chats[\\/]session-[^\\/]+\.json$/;
const CURSOR_WEB_BASE_TRAILING_SLASH_RE = /\/+$/;
const CSV_LINE_RE = /\r?\n/;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SQLITE_LOCKED_RE = /database is locked|SQLITE_BUSY/i;
const MODEL_DATE_SUFFIX_RE = /-\d{8}$/;
const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9._-]+/g;

interface MutableDailyUsage {
  date: string;
  tokens: UsageStatsTokenTotals;
  cost: UsageStatsCostTotals;
  models: Map<string, UsageStatsTokenTotals>;
  modelCosts: Map<string, UsageStatsCostTotals>;
}

interface MutableProviderUsage {
  providerId: UsageStatsCliProviderId;
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

export class LocalCliUsageScannerAdapter implements UsageStatsScannerPort {
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

    summaries.push(
      ...(await Promise.all(
        providers.map((providerId) =>
          this.scanProvider(providerId, start, end, recentStart, warnings)
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
    });
  }

  private async scanProvider(
    providerId: UsageStatsCliProviderId,
    start: Date,
    end: Date,
    recentStart: Date,
    warnings: string[]
  ): Promise<UsageStatsCliProviderSummary> {
    try {
      const usage = await withProviderScanTimeout(
        providerId,
        this.loadProviderUsage(providerId, start, end, recentStart, warnings)
      );

      if (!usage) {
        return buildProviderSummary(
          providerId,
          "not_found",
          createProviderUsage(providerId),
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
        createProviderUsage(providerId),
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
    warnings: string[]
  ): Promise<MutableProviderUsage | null> {
    switch (providerId) {
      case "amp":
        return await loadAmpUsage(start, end, recentStart, warnings);
      case "claude":
        return await loadClaudeUsage(start, end, recentStart, warnings);
      case "codex":
        return await loadCodexUsage(start, end, recentStart, warnings);
      case "cursor":
        return await loadCursorUsage(start, end, recentStart);
      case "gemini":
        return await loadGeminiUsage(start, end, recentStart, warnings);
      case "opencode":
        return await loadOpenCodeUsage(start, end, recentStart, warnings);
      case "pi":
        return await loadPiUsage(start, end, recentStart, warnings);
      default: {
        const exhaustive: never = providerId;
        throw new Error(`Unhandled usage provider: ${String(exhaustive)}`);
      }
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
  providerId: UsageStatsCliProviderId
): MutableProviderUsage {
  return {
    providerId,
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
  recentStart: Date;
}): void {
  if (params.tokens.totalTokens <= 0 || Number.isNaN(params.date.getTime())) {
    return;
  }

  const cost = calculateUsageCost({
    providerId: params.usage.providerId,
    modelName: params.modelName,
    tokens: params.tokens,
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

  if (!params.modelName) {
    return;
  }

  addModelTokens(daily.models, params.modelName, params.tokens);
  addModelCost(daily.modelCosts, params.modelName, cost);
  addModelTokens(params.usage.modelTotals, params.modelName, params.tokens);
  addModelCost(params.usage.modelCosts, params.modelName, cost);

  if (params.date >= params.recentStart) {
    addModelTokens(
      params.usage.recentModelTotals,
      params.modelName,
      params.tokens
    );
    addModelCost(params.usage.recentModelCosts, params.modelName, cost);
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
        const key = modelKey(model.providerId, model.name);
        addModelTokens(daily.models, key, model.tokens);
        addModelCost(daily.modelCosts, key, model.cost);
      }
    }

    for (const model of provider.modelUsage) {
      const key = modelKey(provider.providerId, model.name);
      modelTotals.set(key, {
        ...model,
        tokens: cloneTokens(model.tokens),
        cost: cloneCost(model.cost),
      });
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
        recentModelTotals.set(modelKey(provider.providerId, model.name), {
          ...recentModel,
          tokens: cloneTokens(recentModel.tokens),
          cost: cloneCost(recentModel.cost),
        });
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
            const { providerId, modelName } = parseModelKey(key);
            return {
              name: modelName,
              providerId,
              providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
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
      ...getUsagePricingMetadata(),
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
        .map(([name, tokens]) => ({
          name,
          providerId: provider?.providerId ?? "codex",
          providerDisplayName: provider?.providerDisplayName ?? "Codex",
          tokens: cloneTokens(tokens),
          cost: cloneCost(row.modelCosts.get(name) ?? createEmptyCost()),
        })),
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
    .map(([name, tokens]) => ({
      name,
      providerId,
      providerDisplayName: PROVIDER_DISPLAY_NAMES[providerId],
      tokens: cloneTokens(tokens),
      cost: cloneCost(costMap.get(name) ?? createEmptyCost()),
      share: totalTokens > 0 ? tokens.totalTokens / totalTokens : 0,
    }));
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const threadsDir = path.join(getAmpDataDir(), "threads");
  if (!existsSync(threadsDir)) {
    return null;
  }

  const usage = createProviderUsage("amp");
  const files = await listFilesRecursive(threadsDir, ".json");
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const projectDirs = getClaudeProjectDirs();
  const statsCacheFiles = getClaudeStatsCacheFiles();
  if (projectDirs.length === 0 && statsCacheFiles.length === 0) {
    return null;
  }

  const usage = createProviderUsage("claude");
  const processedHashes = new Set<string>();
  const files = (
    await Promise.all(
      projectDirs.map((dir) => listFilesRecursive(dir, ".jsonl"))
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const usage = createProviderUsage("codex");
  const files = await listFilesRecursive(sessionsDir, ".jsonl");
  await runWithConcurrency(files, getFileConcurrency(), async (file) => {
    await processCodexFile(file, start, end, recentStart, usage, warnings);
  });
  return usage;
}

async function processCodexFile(
  file: string,
  start: Date,
  end: Date,
  recentStart: Date,
  usage: MutableProviderUsage,
  warnings: string[]
): Promise<void> {
  let previousTotals: NormalizedCodexUsage | null = null;
  let currentModel: string | undefined;

  for await (const entry of readJsonLines<{
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
  }>(file, warnings)) {
    const extractedModel = extractCodexModel(entry.payload);

    if (entry.type === "turn_context") {
      currentModel = extractedModel ?? currentModel;
      continue;
    }

    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
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
    if (!isInRange(date, start, end)) {
      continue;
    }
    const modelName = extractedModel ?? currentModel;
    recordUsage({
      usage,
      date,
      tokens: {
        inputTokens: rawUsage.inputTokens,
        outputTokens: rawUsage.outputTokens,
        cacheInputTokens: rawUsage.cachedInputTokens,
        cacheOutputTokens: 0,
        totalTokens: rawUsage.totalTokens,
      },
      modelName: normalizeModelName(modelName),
      recentStart,
    });
  }
}

async function loadCursorUsage(
  start: Date,
  end: Date,
  recentStart: Date
): Promise<MutableProviderUsage | null> {
  const databasePath = getCursorStateDbPath();
  if (!databasePath) {
    return null;
  }

  const accessToken = await readCursorAccessToken(databasePath);
  if (!accessToken) {
    return createProviderUsage("cursor");
  }

  const csvText = await fetchCursorUsageCsv(accessToken);
  const usage = createProviderUsage("cursor");
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const tmpDir = path.join(getGeminiBaseDir(), "tmp");
  if (!existsSync(tmpDir)) {
    return null;
  }

  const usage = createProviderUsage("gemini");
  const files = (await listFilesRecursive(tmpDir, ".json")).filter((file) =>
    GEMINI_SESSION_FILE_RE.test(file)
  );
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const baseDir = getOpenCodeBaseDir();
  const databasePath = path.join(baseDir, "opencode.db");
  const legacyMessagesDir = path.join(baseDir, "storage", "message");
  if (!(existsSync(databasePath) || existsSync(legacyMessagesDir))) {
    return null;
  }

  const usage = createProviderUsage("opencode");
  const dedupe = new Set<string>();
  const addMessage = (message: {
    id?: string;
    role?: string;
    modelID?: string;
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
      recentStart,
    });
  };

  if (existsSync(databasePath)) {
    await withReadonlySqlite(databasePath, (db) => {
      const statement = db.query(
        "SELECT id, data FROM message ORDER BY time_created ASC"
      );
      for (const row of statement.iterate() as Iterable<{
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

  const files = await listFilesRecursive(legacyMessagesDir, ".json");
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
  warnings: string[]
): Promise<MutableProviderUsage | null> {
  const sessionsDir = path.join(getPiAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) {
    return null;
  }

  const usage = createProviderUsage("pi");
  const files = await listFilesRecursive(sessionsDir, ".jsonl");
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

async function listFilesRecursive(
  rootDir: string,
  extension: string
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
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function* readJsonLines<T>(
  file: string,
  warnings: string[]
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
  const stats = await stat(file);
  if (stats.size > maxBytes) {
    throw new Error(
      `JSON document exceeds ${maxBytes} bytes. Increase ${MAX_JSON_RECORD_BYTES_ENV} to process it.`
    );
  }
  return parseJsonTextWithLimit<T>(await readFile(file, "utf8"), file);
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
  const timeoutMs = getProviderScanTimeoutMs();
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

function getProviderScanTimeoutMs(): number {
  return getPositiveIntegerEnv(
    PROVIDER_SCAN_TIMEOUT_MS_ENV,
    DEFAULT_PROVIDER_SCAN_TIMEOUT_MS
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

function asNonEmptyString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function modelKey(
  providerId: UsageStatsCliProviderId,
  modelName: string
): string {
  return `${providerId}\u0000${modelName}`;
}

function parseModelKey(key: string): {
  providerId: UsageStatsCliProviderId;
  modelName: string;
} {
  const [providerId, ...modelParts] = key.split("\u0000");
  return {
    providerId: providerId as UsageStatsCliProviderId,
    modelName: modelParts.join("\u0000"),
  };
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
