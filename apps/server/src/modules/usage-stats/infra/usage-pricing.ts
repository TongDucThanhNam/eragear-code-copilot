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

interface PricingSnapshot {
  _meta: {
    source: string;
    generatedAt: number;
    units: string;
  };
  providers: Record<string, Record<string, CostBuckets>>;
}

interface PricingResolution {
  providerId: string;
  modelId: string;
  source: "models.dev" | "cursor-local";
}

const pricingSnapshot = pricingSnapshotJson as PricingSnapshot;

const CLI_PROVIDER_ALIASES: Record<string, string> = {
  amp: "anthropic",
  claude: "anthropic",
  codex: "openai",
  cursor: "cursor",
  gemini: "google",
  glm: "zai",
  google: "google",
  grok: "xai",
  kimi: "moonshotai",
  opencode: "opencode",
  openai: "openai",
  pi: "openai",
  xai: "xai",
  zai: "zai",
};

const DATE_SUFFIX_PATTERN = /-\d{8}$/;
const CLAUDE_DOTTED_VERSION_PATTERN =
  /(claude-[a-z-]+)-(\d+)\.(\d+)(?=$|[^0-9])/g;
const GLM_FREE_PATTERN = /\bglm-(\d+)\.(\d+)-free\b/g;

const MODEL_PROVIDER_HINTS: [RegExp, string][] = [
  [/^claude|sonnet|opus|haiku/i, "anthropic"],
  [/^gemini/i, "google"],
  [/^gpt|^o\d|codex/i, "openai"],
  [/^glm/i, "zai"],
  [/^kimi/i, "moonshotai"],
  [/^grok/i, "xai"],
];

const MODEL_ALIASES: Record<string, string> = {
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

export function getUsagePricingMetadata() {
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
}): UsageStatsCostTotals {
  const resolution = resolvePricing(params.providerId, params.modelName);
  if (!resolution) {
    return {
      ...createEmptyCost(),
      unpricedTokens: params.tokens.totalTokens,
    };
  }

  const buckets =
    resolution.source === "cursor-local"
      ? CURSOR_LOCAL_PRICING[resolution.modelId]
      : lookupCost(resolution.providerId, resolution.modelId);
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
  modelName?: string
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
      lookupCost(officialAlias.providerId, officialAlias.modelId)
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
    modelId
  );
  for (const candidateProvider of providerCandidates) {
    const resolvedModel = resolveModelForProvider(candidateProvider, modelId);
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
  modelId: string
): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const normalized = normalizeProviderId(value);
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
  providerId: string,
  modelId: string
): string | null {
  const providerModels = pricingSnapshot.providers[providerId];
  if (!providerModels) {
    return null;
  }

  const candidates = getModelCandidates(providerId, modelId);
  return candidates.find((candidate) => providerModels[candidate]) ?? null;
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

  return candidates.filter(
    (candidate, index, list) => candidate && list.indexOf(candidate) === index
  );
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

function lookupCost(providerId: string, modelId: string): CostBuckets | null {
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

function normalizeProviderId(value?: string): string | null {
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
    if (pricingSnapshot.providers[part]) {
      return part;
    }
    const alias = CLI_PROVIDER_ALIASES[part];
    if (alias) {
      return alias;
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
