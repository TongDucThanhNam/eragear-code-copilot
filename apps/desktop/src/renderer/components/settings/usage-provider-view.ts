const OFFPEAK_IDLE_PLAN_ID = "offpeak-idle-plan";
const UNATTRIBUTED_PROVIDER_ID = "unattributed";
const COST_EPSILON = 1e-9;
const BUILTIN_PROVIDER_PREFIX_RE = /^builtin:/;
const OPENAI_MODEL_RE = /^(?:gpt-|chatgpt-|codex-|o[134](?:-|$))/;
const ZAI_MODEL_RE = /^(?:glm-|cogview-|cogvideo-)/;
const PROVIDER_WORD_SEPARATOR_RE = /[-_]+/;
const OPAQUE_PROVIDER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic / Claude",
  cursor: "Cursor Models",
  deepseek: "DeepSeek",
  google: "Google / Gemini",
  minimax: "MiniMax Coding Plan",
  "minimax-coding-plan": "MiniMax Coding Plan",
  moonshotai: "Moonshot AI",
  openai: "OpenAI / ChatGPT (pro)",
  [OFFPEAK_IDLE_PLAN_ID]: "Offpeak Idle Plan",
  [UNATTRIBUTED_PROVIDER_ID]: "Other / Unattributed",
  xai: "xAI",
  zai: "Z.ai Coding Plan",
};

const AGENT_SOURCE_IDS = new Set([
  "antigravity",
  "amp",
  "claude",
  "codex",
  "gemini",
  "opencode",
  "pi",
  "zcode",
]);

export interface UsageTokenTotalsView {
  inputTokens: number;
  outputTokens: number;
  cacheInputTokens: number;
  cacheOutputTokens: number;
  totalTokens: number;
}

export interface UsageCostTotalsView {
  inputUsd: number;
  outputUsd: number;
  cacheInputUsd: number;
  cacheOutputUsd: number;
  totalUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
}

export interface UsageModelInput {
  name: string;
  providerId: string;
  providerDisplayName: string;
  upstreamProviderId?: string;
  tokens: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
}

export interface UsageDailyInput {
  date: string;
  tokens: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  displayTokens: number;
  breakdown: readonly UsageModelInput[];
}

export interface ProviderUsageInput {
  totals: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  modelUsage: readonly UsageModelInput[];
  daily: readonly UsageDailyInput[];
}

export interface ProviderUsageView {
  providerId: string;
  providerDisplayName: string;
  totals: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  modelCount: number;
}

export interface ProviderModelUsageView extends UsageModelInput {
  key: string;
  displayName: string;
  share: number;
}

export interface ProviderDailyUsageView {
  date: string;
  tokens: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  displayTokens: number;
  providers: ProviderUsageView[];
}

export interface ProviderCentricUsageView {
  providers: ProviderUsageView[];
  modelUsage: ProviderModelUsageView[];
  daily: ProviderDailyUsageView[];
}

interface ProviderIdentity {
  id: string;
  label: string;
}

interface MutableProviderUsage {
  identity: ProviderIdentity;
  totals: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  modelKeys: Set<string>;
}

interface MutableModelUsage {
  key: string;
  name: string;
  tokens: UsageTokenTotalsView;
  cost: UsageCostTotalsView;
  providerIds: Set<string>;
}

export function buildProviderCentricUsage(
  usage: ProviderUsageInput
): ProviderCentricUsageView {
  const providers = buildProviderUsageRows(
    usage.modelUsage,
    usage.totals,
    usage.cost
  );
  const modelUsage = buildProviderModelRows(
    usage.modelUsage,
    usage.totals.totalTokens
  );
  const daily = usage.daily.map((day) => ({
    date: day.date,
    tokens: cloneTokens(day.tokens),
    cost: cloneCost(day.cost),
    displayTokens: day.displayTokens,
    providers: buildProviderUsageRows(day.breakdown, day.tokens, day.cost),
  }));

  return { providers, modelUsage, daily };
}

function buildProviderUsageRows(
  models: readonly UsageModelInput[],
  expectedTokens: UsageTokenTotalsView,
  expectedCost: UsageCostTotalsView
): ProviderUsageView[] {
  const providers = new Map<string, MutableProviderUsage>();

  for (const model of models) {
    const identity = resolveProviderIdentity(model);
    let provider = providers.get(identity.id);
    if (!provider) {
      provider = {
        identity,
        totals: emptyTokens(),
        cost: emptyCost(),
        modelKeys: new Set(),
      };
      providers.set(identity.id, provider);
    }
    addTokens(provider.totals, model.tokens);
    addCost(provider.cost, model.cost);
    provider.modelKeys.add(normalizeModelName(model.name));
  }

  const attributedTokens = emptyTokens();
  const attributedCost = emptyCost();
  for (const provider of providers.values()) {
    addTokens(attributedTokens, provider.totals);
    addCost(attributedCost, provider.cost);
  }
  const remainingTokens = subtractTokens(expectedTokens, attributedTokens);
  const remainingCost = subtractCost(expectedCost, attributedCost);
  if (
    remainingTokens.totalTokens > 0 ||
    remainingCost.totalUsd > COST_EPSILON
  ) {
    providers.set(UNATTRIBUTED_PROVIDER_ID, {
      identity: providerIdentity(UNATTRIBUTED_PROVIDER_ID),
      totals: remainingTokens,
      cost: remainingCost,
      modelKeys: new Set(),
    });
  }

  return [...providers.values()]
    .map((provider) => ({
      providerId: provider.identity.id,
      providerDisplayName: provider.identity.label,
      totals: provider.totals,
      cost: provider.cost,
      modelCount: provider.modelKeys.size,
    }))
    .filter(
      (provider) =>
        provider.totals.totalTokens > 0 || provider.cost.totalUsd > 0
    )
    .sort(
      (left, right) =>
        right.cost.totalUsd - left.cost.totalUsd ||
        right.totals.totalTokens - left.totals.totalTokens
    );
}

function buildProviderModelRows(
  models: readonly UsageModelInput[],
  totalTokens: number
): ProviderModelUsageView[] {
  const rows = new Map<string, MutableModelUsage>();

  for (const model of models) {
    const identity = resolveProviderIdentity(model);
    const name = normalizeModelName(model.name);
    const key =
      identity.id === OFFPEAK_IDLE_PLAN_ID
        ? `${name}\u0000${OFFPEAK_IDLE_PLAN_ID}`
        : name;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        name,
        tokens: emptyTokens(),
        cost: emptyCost(),
        providerIds: new Set(),
      };
      rows.set(key, row);
    }
    addTokens(row.tokens, model.tokens);
    addCost(row.cost, model.cost);
    row.providerIds.add(identity.id);
  }

  return [...rows.values()].map((row) => {
    const providerIds = [...row.providerIds];
    const providerId =
      providerIds.length === 1
        ? (providerIds[0] ?? UNATTRIBUTED_PROVIDER_ID)
        : "multiple";
    const isOffpeak = providerId === OFFPEAK_IDLE_PLAN_ID;
    return {
      key: row.key,
      name: row.name,
      displayName: isOffpeak
        ? `${row.name} — ${PROVIDER_LABELS[OFFPEAK_IDLE_PLAN_ID]}`
        : row.name,
      providerId,
      providerDisplayName:
        providerIds.length === 1
          ? getProviderDisplayName(providerId)
          : "Multiple providers",
      ...(isOffpeak ? { upstreamProviderId: OFFPEAK_IDLE_PLAN_ID } : {}),
      tokens: row.tokens,
      cost: row.cost,
      share: totalTokens > 0 ? row.tokens.totalTokens / totalTokens : 0,
    };
  });
}

function resolveProviderIdentity(model: UsageModelInput): ProviderIdentity {
  const upstream = normalizeProviderId(model.upstreamProviderId);
  if (upstream && !OPAQUE_PROVIDER_ID_RE.test(upstream)) {
    return providerIdentity(upstream);
  }

  const inferred = inferProviderFromModel(model.name);
  if (inferred) {
    return providerIdentity(inferred);
  }

  const source = normalizeProviderId(model.providerId);
  if (source && !AGENT_SOURCE_IDS.has(source)) {
    return providerIdentity(source);
  }
  return providerIdentity(UNATTRIBUTED_PROVIDER_ID);
}

function normalizeProviderId(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(BUILTIN_PROVIDER_PREFIX_RE, "");
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("offpeak-idle-plan")) {
    return OFFPEAK_IDLE_PLAN_ID;
  }
  if (normalized.includes("minimax")) {
    return "minimax-coding-plan";
  }
  if (
    normalized === "zai" ||
    normalized.includes("z.ai") ||
    normalized.includes("zai-coding-plan") ||
    normalized.includes("z-code")
  ) {
    return "zai";
  }
  if (
    normalized === "openai" ||
    normalized === "chatgpt" ||
    normalized === "codex"
  ) {
    return "openai";
  }
  if (normalized === "anthropic" || normalized === "claude") {
    return "anthropic";
  }
  if (normalized === "google" || normalized === "gemini") {
    return "google";
  }
  return normalized;
}

function inferProviderFromModel(modelName: string): string | undefined {
  const normalized = normalizeModelName(modelName);
  if (OPENAI_MODEL_RE.test(normalized)) {
    return "openai";
  }
  if (normalized.startsWith("claude-")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini-")) {
    return "google";
  }
  if (ZAI_MODEL_RE.test(normalized)) {
    return "zai";
  }
  if (normalized.startsWith("minimax-")) {
    return "minimax-coding-plan";
  }
  if (normalized.startsWith("grok-")) {
    return "xai";
  }
  if (normalized.startsWith("kimi-")) {
    return "moonshotai";
  }
  if (normalized.startsWith("deepseek-")) {
    return "deepseek";
  }
  return undefined;
}

function providerIdentity(id: string): ProviderIdentity {
  return { id, label: getProviderDisplayName(id) };
}

function getProviderDisplayName(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? prettifyProviderId(providerId);
}

function prettifyProviderId(providerId: string): string {
  return providerId
    .split(PROVIDER_WORD_SEPARATOR_RE)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase();
}

function emptyTokens(): UsageTokenTotalsView {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheInputTokens: 0,
    cacheOutputTokens: 0,
    totalTokens: 0,
  };
}

function emptyCost(): UsageCostTotalsView {
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

function cloneTokens(tokens: UsageTokenTotalsView): UsageTokenTotalsView {
  return { ...tokens };
}

function cloneCost(cost: UsageCostTotalsView): UsageCostTotalsView {
  return { ...cost };
}

function addTokens(
  target: UsageTokenTotalsView,
  source: UsageTokenTotalsView
): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheInputTokens += source.cacheInputTokens;
  target.cacheOutputTokens += source.cacheOutputTokens;
  target.totalTokens += source.totalTokens;
}

function addCost(
  target: UsageCostTotalsView,
  source: UsageCostTotalsView
): void {
  target.inputUsd += source.inputUsd;
  target.outputUsd += source.outputUsd;
  target.cacheInputUsd += source.cacheInputUsd;
  target.cacheOutputUsd += source.cacheOutputUsd;
  target.totalUsd += source.totalUsd;
  target.pricedTokens += source.pricedTokens;
  target.unpricedTokens += source.unpricedTokens;
}

function subtractTokens(
  total: UsageTokenTotalsView,
  attributed: UsageTokenTotalsView
): UsageTokenTotalsView {
  return {
    inputTokens: Math.max(0, total.inputTokens - attributed.inputTokens),
    outputTokens: Math.max(0, total.outputTokens - attributed.outputTokens),
    cacheInputTokens: Math.max(
      0,
      total.cacheInputTokens - attributed.cacheInputTokens
    ),
    cacheOutputTokens: Math.max(
      0,
      total.cacheOutputTokens - attributed.cacheOutputTokens
    ),
    totalTokens: Math.max(0, total.totalTokens - attributed.totalTokens),
  };
}

function subtractCost(
  total: UsageCostTotalsView,
  attributed: UsageCostTotalsView
): UsageCostTotalsView {
  return {
    inputUsd: Math.max(0, total.inputUsd - attributed.inputUsd),
    outputUsd: Math.max(0, total.outputUsd - attributed.outputUsd),
    cacheInputUsd: Math.max(0, total.cacheInputUsd - attributed.cacheInputUsd),
    cacheOutputUsd: Math.max(
      0,
      total.cacheOutputUsd - attributed.cacheOutputUsd
    ),
    totalUsd: Math.max(0, total.totalUsd - attributed.totalUsd),
    pricedTokens: Math.max(0, total.pricedTokens - attributed.pricedTokens),
    unpricedTokens: Math.max(
      0,
      total.unpricedTokens - attributed.unpricedTokens
    ),
  };
}
