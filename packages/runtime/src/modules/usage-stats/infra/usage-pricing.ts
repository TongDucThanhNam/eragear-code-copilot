import type {
  UsageStatsCliProviderId,
  UsageStatsCostTotals,
  UsageStatsTokenTotals,
} from "../application/contracts/usage-stats.contract";
import pricingSnapshotJson from "./modelsdev-pricing.min.json";

interface CostBuckets {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface PricingSnapshot {
  _meta: {
    source: string;
    generatedAt: number;
    units: string;
    providers?: string[];
  };
  providers: Record<string, Record<string, CostBuckets>>;
}

interface PricingResolution {
  providerId: string;
  modelId: string;
  source: "models.dev" | "cursor-local";
}

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const OPENROUTER_MODELS_API_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=all";
const PRICING_FETCH_TIMEOUT_MS_ENV = "SLOPMETER_PRICING_FETCH_TIMEOUT_MS";
const PRICING_CACHE_TTL_MS_ENV = "SLOPMETER_PRICING_CACHE_TTL_MS";
const DEFAULT_PRICING_FETCH_TIMEOUT_MS = 2500;
const DEFAULT_PRICING_CACHE_TTL_MS = 0;

const bundledPricingSnapshot = pricingSnapshotJson as PricingSnapshot;
let runtimePricingSnapshot: PricingSnapshot | null = null;
let runtimePricingFetchedAt = 0;
let pendingPricingFetch: Promise<PricingSnapshot> | null = null;

const CLI_PROVIDER_ALIASES: Record<string, string> = {
  amp: "anthropic",
  claude: "anthropic",
  codex: "openai",
  cursor: "cursor",
  "default-minimax": "minimax",
  gemini: "google",
  glm: "zai",
  google: "google",
  grok: "xai",
  kimi: "moonshotai",
  minimax: "minimax",
  opencode: "opencode",
  openai: "openai",
  pi: "openai",
  xai: "xai",
  zai: "zai",
  "z-ai": "zai",
  "zai-coding-plan": "zai",
};

const DATE_SUFFIX_PATTERN = /-\d{8}$/;
const CLAUDE_DOTTED_VERSION_PATTERN =
  /(claude-[a-z-]+)-(\d+)\.(\d+)(?=$|[^0-9])/g;
const GLM_FREE_PATTERN = /\bglm-(\d+)\.(\d+)-free\b/g;
const OPENAI_GPT_VERSION_PATTERN = /^gpt-(\d+)\.(\d+)(-.*)?$/;

const MODEL_PROVIDER_HINTS: [RegExp, string][] = [
  [/^claude|sonnet|opus|haiku/i, "anthropic"],
  [/^deepseek/i, "deepseek"],
  [/^gemini/i, "google"],
  [/^gpt|^o\d|codex/i, "openai"],
  [/^glm/i, "zai"],
  [/^kimi/i, "moonshotai"],
  [/^minimax/i, "minimax"],
  [/^grok/i, "xai"],
];

const MODEL_ALIASES: Record<string, string> = {
  "gemini 3.1 pro (high)": "gemini-3.1-pro-preview",
  "gemini 3.1 pro (low)": "gemini-3.1-pro-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "gemini-3.1-pro-high": "gemini-3.1-pro-preview",
  "gemini-3.1-pro-low": "gemini-3.1-pro-preview",
  "gemini-pro-c": "gemini-3.1-pro-preview",
  "gemini-pro-default": "gemini-3.1-pro-preview",
  "gpt-5-5": "gpt-5.5",
  "gpt-5-5-pro": "gpt-5.5-pro",
  "opus-4.5": "claude-opus-4-5",
  "opus-4.5-thinking": "claude-opus-4-5",
  "opus-4.6": "claude-opus-4-6",
  "opus-4.6-thinking": "claude-opus-4-6",
  "sonnet-4.5": "claude-sonnet-4-5",
  "sonnet-4.5-thinking": "claude-sonnet-4-5",
  "sonnet-4.6": "claude-sonnet-4-6",
  "sonnet-4.6-thinking": "claude-sonnet-4-6",
};

const CURSOR_LOCAL_PRICING: Record<string, CostBuckets> = {
  auto: {
    input: 1.25,
    output: 6,
    cache_read: 0.25,
  },
  "composer-1": {
    input: 1.25,
    output: 10,
    cache_read: 0.125,
  },
  "composer-1.5": {
    input: 3.5,
    output: 17.5,
    cache_read: 0.35,
  },
  "composer-2": {
    input: 0.5,
    output: 2.5,
    cache_read: 0.2,
  },
  "composer-2-fast": {
    input: 1.5,
    output: 7.5,
    cache_read: 0.35,
  },
};

const CURSOR_MODEL_ALIASES: Record<string, string> = {
  "default[]": "auto",
};

const CURSOR_OFFICIAL_ALIASES: Record<
  string,
  { providerId: string; modelId: string }
> = {
  "claude-4.5-sonnet": {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
  },
  "gemini-3-flash": {
    providerId: "google",
    modelId: "gemini-3-flash-preview",
  },
  "gemini-3-pro": {
    providerId: "google",
    modelId: "gemini-3-pro-preview",
  },
  "gpt-5.2-codex": {
    providerId: "openai",
    modelId: "gpt-5.2-codex",
  },
  grok: {
    providerId: "xai",
    modelId: "grok-code-fast-1",
  },
  "kimi-k2.5": {
    providerId: "moonshotai",
    modelId: "kimi-k2.5",
  },
  "opus-4.5": {
    providerId: "anthropic",
    modelId: "claude-opus-4-5",
  },
  "sonnet-4.5": {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
  },
};

export function createEmptyCost(): UsageStatsCostTotals {
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

export function cloneCost(cost: UsageStatsCostTotals): UsageStatsCostTotals {
  return {
    inputUsd: cost.inputUsd,
    outputUsd: cost.outputUsd,
    cacheInputUsd: cost.cacheInputUsd,
    cacheOutputUsd: cost.cacheOutputUsd,
    totalUsd: cost.totalUsd,
    pricedTokens: cost.pricedTokens,
    unpricedTokens: cost.unpricedTokens,
  };
}

export function addCost(
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

export async function loadUsagePricingSnapshot(
  warnings?: string[]
): Promise<PricingSnapshot> {
  const cacheTtlMs = readNonNegativeIntegerEnv(
    PRICING_CACHE_TTL_MS_ENV,
    DEFAULT_PRICING_CACHE_TTL_MS
  );
  const now = Date.now();
  if (
    runtimePricingSnapshot &&
    cacheTtlMs > 0 &&
    now - runtimePricingFetchedAt < cacheTtlMs
  ) {
    return runtimePricingSnapshot;
  }

  try {
    const snapshot = await fetchRuntimePricingSnapshot();
    runtimePricingSnapshot = snapshot;
    runtimePricingFetchedAt = Date.now();
    return snapshot;
  } catch (error) {
    const fallbackSnapshot = runtimePricingSnapshot ?? bundledPricingSnapshot;
    warnings?.push(
      `Pricing catalog refresh failed; using ${fallbackSnapshot._meta.source}: ${formatErrorMessage(
        error
      )}`
    );
    return fallbackSnapshot;
  }
}

export function getUsagePricingMetadata(
  pricingSnapshot: PricingSnapshot = runtimePricingSnapshot ??
    bundledPricingSnapshot
) {
  return {
    source: pricingSnapshot._meta.source,
    generatedAt: pricingSnapshot._meta.generatedAt,
    units: pricingSnapshot._meta.units,
  };
}

export function calculateUsageCost(params: {
  providerId: UsageStatsCliProviderId;
  modelName?: string;
  tokens: UsageStatsTokenTotals;
  pricingSnapshot?: PricingSnapshot;
}): UsageStatsCostTotals {
  const pricingSnapshot =
    params.pricingSnapshot ?? runtimePricingSnapshot ?? bundledPricingSnapshot;
  const resolution = resolvePricing(
    params.providerId,
    params.modelName,
    pricingSnapshot
  );
  if (!resolution) {
    return {
      ...createEmptyCost(),
      unpricedTokens: params.tokens.totalTokens,
    };
  }

  const buckets =
    resolution.source === "cursor-local"
      ? CURSOR_LOCAL_PRICING[resolution.modelId]
      : lookupCost(pricingSnapshot, resolution.providerId, resolution.modelId);
  if (!buckets) {
    return {
      ...createEmptyCost(),
      unpricedTokens: params.tokens.totalTokens,
    };
  }

  const billable = toBillableBuckets(params.providerId, params.tokens);
  const inputUsd = costForTokens(billable.input, buckets.input);
  const outputUsd = costForTokens(billable.output, buckets.output);
  const cacheInputUsd = costForTokens(
    billable.cacheInput,
    buckets.cache_read ?? buckets.input
  );
  const cacheOutputUsd = costForTokens(
    billable.cacheOutput,
    buckets.cache_write ?? buckets.input
  );

  return {
    inputUsd,
    outputUsd,
    cacheInputUsd,
    cacheOutputUsd,
    totalUsd: inputUsd + outputUsd + cacheInputUsd + cacheOutputUsd,
    pricedTokens: params.tokens.totalTokens,
    unpricedTokens: 0,
  };
}

function toBillableBuckets(
  providerId: UsageStatsCliProviderId,
  tokens: UsageStatsTokenTotals
): {
  input: number;
  output: number;
  cacheInput: number;
  cacheOutput: number;
} {
  if (providerId === "cursor") {
    return {
      input: Math.max(
        0,
        tokens.inputTokens - tokens.cacheInputTokens - tokens.cacheOutputTokens
      ),
      output: tokens.outputTokens,
      cacheInput: tokens.cacheInputTokens,
      cacheOutput: tokens.cacheOutputTokens,
    };
  }

  return {
    input: Math.max(0, tokens.inputTokens - tokens.cacheInputTokens),
    output: Math.max(0, tokens.outputTokens - tokens.cacheOutputTokens),
    cacheInput: tokens.cacheInputTokens,
    cacheOutput: tokens.cacheOutputTokens,
  };
}

function costForTokens(tokens: number, usdPerMillion?: number): number {
  if (!(typeof usdPerMillion === "number" && Number.isFinite(usdPerMillion))) {
    return 0;
  }
  return (tokens * usdPerMillion) / 1_000_000;
}

function resolvePricing(
  providerId: UsageStatsCliProviderId,
  modelName: string | undefined,
  pricingSnapshot: PricingSnapshot
): PricingResolution | null {
  const parsed = parseModelHint(modelName);
  const modelId = normalizeModelId(parsed.modelId);
  if (!modelId) {
    return null;
  }

  if (providerId === "cursor") {
    const cursorLocalModel = CURSOR_MODEL_ALIASES[modelId] ?? modelId;
    if (CURSOR_LOCAL_PRICING[cursorLocalModel]) {
      return {
        providerId: "cursor",
        modelId: cursorLocalModel,
        source: "cursor-local",
      };
    }

    const officialAlias = CURSOR_OFFICIAL_ALIASES[modelId];
    if (
      officialAlias &&
      lookupCost(
        pricingSnapshot,
        officialAlias.providerId,
        officialAlias.modelId
      )
    ) {
      return {
        providerId: officialAlias.providerId,
        modelId: officialAlias.modelId,
        source: "models.dev",
      };
    }
  }

  const providerCandidates = getProviderCandidates(
    providerId,
    parsed.providerId,
    modelId,
    pricingSnapshot
  );
  for (const candidateProvider of providerCandidates) {
    const resolvedModel = resolveModelForProvider(
      pricingSnapshot,
      candidateProvider,
      modelId
    );
    if (resolvedModel) {
      return {
        providerId: candidateProvider,
        modelId: resolvedModel,
        source: "models.dev",
      };
    }
  }

  return null;
}

function getProviderCandidates(
  providerId: UsageStatsCliProviderId,
  modelProviderHint: string | undefined,
  modelId: string,
  pricingSnapshot: PricingSnapshot
): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const normalized = normalizeProviderId(value, pricingSnapshot);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  add(modelProviderHint);
  add(providerId);
  add(inferProviderFromModel(modelId) ?? undefined);

  return candidates;
}

function resolveModelForProvider(
  pricingSnapshot: PricingSnapshot,
  providerId: string,
  modelId: string
): string | null {
  if (!pricingSnapshot.providers[providerId]) {
    return null;
  }

  const candidates = getModelCandidates(providerId, modelId);
  return (
    candidates.find((candidate) =>
      lookupCost(pricingSnapshot, providerId, candidate)
    ) ?? null
  );
}

function getModelCandidates(providerId: string, modelId: string): string[] {
  const aliased = MODEL_ALIASES[modelId] ?? modelId;
  const candidates = [aliased];

  if (aliased.endsWith("-free")) {
    candidates.push(aliased.slice(0, -"-free".length));
  }
  if (aliased.endsWith("-thinking")) {
    candidates.push(aliased.slice(0, -"-thinking".length));
  }
  if (providerId === "google" && aliased === "gemini-3-pro") {
    candidates.push("gemini-3-pro-preview");
  }
  if (providerId === "google" && aliased === "gemini-3-flash") {
    candidates.push("gemini-3-flash-preview");
  }
  if (providerId === "moonshotai" && aliased === "kimi-k2") {
    candidates.push("kimi-k2-thinking");
  }
  if (providerId === "anthropic") {
    candidates.push(...anthropicVersionFallbacks(aliased));
  }
  if (providerId === "openai") {
    candidates.push(...openAiVersionFallbacks(aliased));
  }

  return candidates.filter(
    (candidate, index, list) => candidate && list.indexOf(candidate) === index
  );
}

function openAiVersionFallbacks(modelId: string): string[] {
  const match = OPENAI_GPT_VERSION_PATTERN.exec(modelId);
  if (!match) {
    return [];
  }

  const majorVersion = match[1];
  const minorVersion = Number.parseInt(match[2] ?? "", 10);
  const suffix = match[3] ?? "";
  if (!(majorVersion && Number.isFinite(minorVersion))) {
    return [];
  }

  const candidates: string[] = [];
  if (suffix) {
    for (let version = minorVersion - 1; version >= 1; version -= 1) {
      candidates.push(`gpt-${majorVersion}.${version}${suffix}`);
    }
    candidates.push(`gpt-${majorVersion}${suffix}`);
  }

  for (let version = minorVersion - 1; version >= 1; version -= 1) {
    candidates.push(`gpt-${majorVersion}.${version}`);
  }
  candidates.push(`gpt-${majorVersion}`);
  return candidates;
}

function anthropicVersionFallbacks(modelId: string): string[] {
  if (modelId === "claude-opus-4-6") {
    return ["claude-opus-4-5"];
  }
  if (modelId === "claude-sonnet-4-6") {
    return ["claude-sonnet-4-5"];
  }
  return [];
}

function lookupCost(
  pricingSnapshot: PricingSnapshot,
  providerId: string,
  modelId: string
): CostBuckets | null {
  return pricingSnapshot.providers[providerId]?.[modelId] ?? null;
}

function parseModelHint(modelName?: string): {
  providerId?: string;
  modelId?: string;
} {
  const trimmed = modelName?.trim();
  if (!trimmed) {
    return {};
  }

  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) {
    return { modelId: trimmed };
  }
  return {
    providerId: trimmed.slice(0, lastSlash),
    modelId: trimmed.slice(lastSlash + 1),
  };
}

function normalizeProviderId(
  value: string | undefined,
  pricingSnapshot: PricingSnapshot
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split(/[/:]/g).filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }
    const alias = CLI_PROVIDER_ALIASES[part];
    if (alias) {
      return alias;
    }
    if (pricingSnapshot.providers[part]) {
      return part;
    }
  }

  return CLI_PROVIDER_ALIASES[normalized] ?? normalized;
}

function normalizeModelId(value?: string): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(DATE_SUFFIX_PATTERN, "")
    .replace(CLAUDE_DOTTED_VERSION_PATTERN, "$1-$2-$3")
    .replace(GLM_FREE_PATTERN, "glm-$1.$2");
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES[normalized] ?? normalized;
}

function inferProviderFromModel(modelId: string): string | null {
  for (const [pattern, providerId] of MODEL_PROVIDER_HINTS) {
    if (pattern.test(modelId)) {
      return providerId;
    }
  }
  return null;
}

async function fetchRuntimePricingSnapshot(): Promise<PricingSnapshot> {
  if (!pendingPricingFetch) {
    pendingPricingFetch = fetchMergedRuntimePricingSnapshot().finally(() => {
      pendingPricingFetch = null;
    });
  }
  return await pendingPricingFetch;
}

async function fetchMergedRuntimePricingSnapshot(): Promise<PricingSnapshot> {
  const results = await Promise.allSettled([
    fetchModelsDevPricingSnapshot(),
    fetchOpenRouterPricingSnapshot(),
  ]);
  const snapshots = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (snapshots.length === 0) {
    throw new Error(
      results
        .map((result) =>
          result.status === "rejected" ? formatErrorMessage(result.reason) : ""
        )
        .filter(Boolean)
        .join("; ") || "pricing sources did not return model pricing"
    );
  }
  return mergePricingSnapshots(snapshots);
}

async function fetchModelsDevPricingSnapshot(): Promise<PricingSnapshot> {
  const timeoutMs = readNonNegativeIntegerEnv(
    PRICING_FETCH_TIMEOUT_MS_ENV,
    DEFAULT_PRICING_FETCH_TIMEOUT_MS
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(MODELS_DEV_API_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`models.dev returned HTTP ${response.status}`);
    }
    return createPricingSnapshotFromModelsDev(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenRouterPricingSnapshot(): Promise<PricingSnapshot> {
  const timeoutMs = readNonNegativeIntegerEnv(
    PRICING_FETCH_TIMEOUT_MS_ENV,
    DEFAULT_PRICING_FETCH_TIMEOUT_MS
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_MODELS_API_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter returned HTTP ${response.status}`);
    }
    return createPricingSnapshotFromOpenRouter(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function createPricingSnapshotFromModelsDev(catalog: unknown): PricingSnapshot {
  if (!(catalog && typeof catalog === "object")) {
    throw new Error("models.dev response is not an object");
  }

  const providers: PricingSnapshot["providers"] = {};
  for (const [providerId, provider] of Object.entries(
    catalog as Record<string, unknown>
  )) {
    if (!(provider && typeof provider === "object")) {
      continue;
    }

    const models = (provider as { models?: unknown }).models;
    if (!(models && typeof models === "object")) {
      continue;
    }

    const modelPricing: Record<string, CostBuckets> = {};
    for (const [modelId, model] of Object.entries(
      models as Record<string, unknown>
    )) {
      if (!(model && typeof model === "object")) {
        continue;
      }

      const buckets = readCostBuckets((model as { cost?: unknown }).cost);
      if (buckets) {
        modelPricing[normalizeModelSnapshotId(modelId)] = buckets;
      }
    }

    if (Object.keys(modelPricing).length > 0) {
      providers[normalizeProviderSnapshotId(providerId)] = Object.fromEntries(
        Object.entries(modelPricing).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      );
    }
  }

  const providerIds = Object.keys(providers).sort();
  if (providerIds.length === 0) {
    throw new Error("models.dev response did not include model pricing");
  }

  const sortedProviders: PricingSnapshot["providers"] = {};
  for (const providerId of providerIds) {
    const providerModels = providers[providerId];
    if (providerModels) {
      sortedProviders[providerId] = providerModels;
    }
  }

  return {
    _meta: {
      source: MODELS_DEV_API_URL,
      generatedAt: Date.now(),
      units: "USD per 1M tokens",
      providers: providerIds,
    },
    providers: sortedProviders,
  };
}

function createPricingSnapshotFromOpenRouter(
  catalog: unknown
): PricingSnapshot {
  if (!(catalog && typeof catalog === "object")) {
    throw new Error("OpenRouter response is not an object");
  }

  const models = (catalog as { data?: unknown }).data;
  if (!Array.isArray(models)) {
    throw new Error("OpenRouter response did not include model data");
  }

  const providers: PricingSnapshot["providers"] = {};
  for (const model of models) {
    if (!(model && typeof model === "object")) {
      continue;
    }

    const id = (model as { id?: unknown }).id;
    if (typeof id !== "string") {
      continue;
    }
    const lastSlash = id.lastIndexOf("/");
    if (lastSlash <= 0 || lastSlash === id.length - 1) {
      continue;
    }

    const buckets = readOpenRouterCostBuckets(
      (model as { pricing?: unknown }).pricing
    );
    if (!buckets) {
      continue;
    }

    const providerId = normalizeProviderSnapshotId(id.slice(0, lastSlash));
    const modelId = normalizeModelSnapshotId(id.slice(lastSlash + 1));
    const providerPricing = providers[providerId] ?? {};
    providerPricing[modelId] = buckets;
    providers[providerId] = providerPricing;
  }

  const providerIds = Object.keys(providers).sort();
  if (providerIds.length === 0) {
    throw new Error("OpenRouter response did not include model pricing");
  }

  return {
    _meta: {
      source: OPENROUTER_MODELS_API_URL,
      generatedAt: Date.now(),
      units: "USD per 1M tokens",
      providers: providerIds,
    },
    providers: sortPricingProviders(providers),
  };
}

function mergePricingSnapshots(snapshots: PricingSnapshot[]): PricingSnapshot {
  const providers: PricingSnapshot["providers"] = {};
  for (const snapshot of snapshots) {
    for (const [providerId, models] of Object.entries(snapshot.providers)) {
      const normalizedProvider = normalizeProviderSnapshotId(providerId);
      const providerPricing = providers[normalizedProvider] ?? {};
      for (const [modelId, buckets] of Object.entries(models)) {
        providerPricing[normalizeModelSnapshotId(modelId)] = { ...buckets };
      }
      providers[normalizedProvider] = providerPricing;
    }
  }

  const providerIds = Object.keys(providers).sort();
  return {
    _meta: {
      source: snapshots.map((snapshot) => snapshot._meta.source).join(" + "),
      generatedAt: Math.max(
        ...snapshots.map((snapshot) => snapshot._meta.generatedAt)
      ),
      units: "USD per 1M tokens",
      providers: providerIds,
    },
    providers: sortPricingProviders(providers),
  };
}

function sortPricingProviders(
  providers: PricingSnapshot["providers"]
): PricingSnapshot["providers"] {
  const sortedProviders: PricingSnapshot["providers"] = {};
  for (const providerId of Object.keys(providers).sort()) {
    const models = providers[providerId];
    if (!models) {
      continue;
    }
    sortedProviders[providerId] = Object.fromEntries(
      Object.entries(models).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );
  }
  return sortedProviders;
}

function readCostBuckets(value: unknown): CostBuckets | null {
  if (!(value && typeof value === "object")) {
    return null;
  }

  const cost = value as Record<string, unknown>;
  const buckets: CostBuckets = {};
  for (const key of ["input", "output", "cache_read", "cache_write"] as const) {
    const bucketValue = cost[key];
    if (typeof bucketValue === "number" && Number.isFinite(bucketValue)) {
      buckets[key] = bucketValue;
    }
  }

  return Object.keys(buckets).length > 0 ? buckets : null;
}

function readOpenRouterCostBuckets(value: unknown): CostBuckets | null {
  if (!(value && typeof value === "object")) {
    return null;
  }

  const pricing = value as Record<string, unknown>;
  const buckets: CostBuckets = {};
  const assign = (target: keyof CostBuckets, source: string) => {
    const perMillion = readOpenRouterUsdPerMillion(pricing[source]);
    if (perMillion !== null) {
      buckets[target] = perMillion;
    }
  };

  assign("input", "prompt");
  assign("output", "completion");
  assign("cache_read", "input_cache_read");
  assign("cache_write", "input_cache_write");
  if (buckets.cache_read !== undefined && buckets.cache_write === undefined) {
    buckets.cache_write = 0;
  }

  return Object.keys(buckets).length > 0 ? buckets : null;
}

function readOpenRouterUsdPerMillion(value: unknown): number | null {
  let numeric = Number.NaN;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    numeric = Number.parseFloat(value);
  }
  return Number.isFinite(numeric) ? numeric * 1_000_000 : null;
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeProviderSnapshotId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return CLI_PROVIDER_ALIASES[normalized] ?? normalized;
}

function normalizeModelSnapshotId(value: string): string {
  return value.trim().toLowerCase();
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
