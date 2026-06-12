import type { QuotaWindow } from "../application/contracts/quota.contract";
import type {
  QuotaAuthOk,
  QuotaAuthResult,
  QuotaProviderAdapter,
  QuotaProviderContext,
  QuotaProviderFetchResult,
} from "../application/ports/quota-provider.port";
import { findApiKeyInLocalAuth } from "./local-auth";
import {
  agentsMatchProvider,
  asArray,
  asRecord,
  clampPercent,
  type FetchLike,
  fetchJsonWithTimeout,
  getEnvValue,
  hasEnvValue,
  parseResetAt,
  percentRemainingFromCounts,
  readNumber,
  readString,
} from "./quota-adapter-utils";

const GLOBAL_ENDPOINT = "https://api.minimax.io/v1/token_plan/remains";
const CHINA_ENDPOINT = "https://api.minimaxi.com/v1/token_plan/remains";
const REQUEST_TIMEOUT_MS = 10_000;

const GLOBAL_ENV_KEYS = [
  "MINIMAX_CODING_PLAN_API_KEY",
  "MINIMAX_API_KEY",
] as const;
const CHINA_ENV_KEYS = ["MINIMAX_CHINA_CODING_PLAN_API_KEY"] as const;
const GLOBAL_AUTH_KEYS = ["minimax-coding-plan", "minimax"] as const;
const CHINA_AUTH_KEYS = [
  "minimax-china-coding-plan",
  "minimax-cn-coding-plan",
  "minimax-cn",
  "minimax-china",
] as const;
const GLOBAL_CREDENTIAL_KEYS = [
  ...GLOBAL_AUTH_KEYS,
  "default-minimax",
  "builtin:minimax",
  "builtin:minimax-coding-plan",
] as const;
const CHINA_CREDENTIAL_KEYS = [...CHINA_AUTH_KEYS] as const;
const GLOBAL_CREDENTIAL_NAMES = ["MiniMax Coding Plan", "MiniMax"] as const;
const CHINA_CREDENTIAL_NAMES = [
  "MiniMax Coding Plan (CN)",
  "MiniMax China Coding Plan",
] as const;
const API_KEY_CREDENTIAL_KINDS = ["api_key", "bearer_token"] as const;

type MinimaxEndpointVariant = "global" | "china";
type CounterSemantics = "remaining" | "used";

const COUNTER_SEMANTICS: Record<MinimaxEndpointVariant, CounterSemantics> = {
  global: "used",
  china: "used",
};

export class MiniMaxQuotaAdapter implements QuotaProviderAdapter {
  readonly id = "minimax-coding-plan";
  readonly aliases = [...GLOBAL_CREDENTIAL_KEYS, ...CHINA_CREDENTIAL_KEYS];
  readonly displayName = "MiniMax Coding Plan";
  readonly source = "remote_api" as const;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  detect(ctx: QuotaProviderContext): boolean {
    return (
      hasEnvValue([...GLOBAL_ENV_KEYS, ...CHINA_ENV_KEYS]) ||
      agentsMatchProvider(ctx.agents, this.aliases)
    );
  }

  async resolveAuth(ctx: QuotaProviderContext): Promise<QuotaAuthResult> {
    const globalToken = firstEnvValue(GLOBAL_ENV_KEYS);
    if (globalToken) {
      return {
        ok: true,
        token: globalToken,
        source: "env",
        endpointVariant: "global",
      };
    }

    const chinaToken = firstEnvValue(CHINA_ENV_KEYS);
    if (chinaToken) {
      return {
        ok: true,
        token: chinaToken,
        source: "env",
        endpointVariant: "china",
      };
    }

    const globalCredential = await ctx.credentialResolver?.resolveFirst(
      ctx.userId,
      {
        providerIds: GLOBAL_CREDENTIAL_KEYS,
        names: GLOBAL_CREDENTIAL_NAMES,
        kinds: API_KEY_CREDENTIAL_KINDS,
      }
    );
    if (globalCredential) {
      return {
        ok: true,
        token: globalCredential.secret,
        source: "credential",
        endpointVariant: "global",
      };
    }

    const chinaCredential = await ctx.credentialResolver?.resolveFirst(
      ctx.userId,
      {
        providerIds: CHINA_CREDENTIAL_KEYS,
        names: CHINA_CREDENTIAL_NAMES,
        kinds: API_KEY_CREDENTIAL_KINDS,
      }
    );
    if (chinaCredential) {
      return {
        ok: true,
        token: chinaCredential.secret,
        source: "credential",
        endpointVariant: "china",
      };
    }

    const globalLocalAuth = await findApiKeyInLocalAuth(GLOBAL_AUTH_KEYS);
    if (globalLocalAuth) {
      return {
        ok: true,
        token: globalLocalAuth.token,
        source: "local_auth",
        endpointVariant: "global",
      };
    }

    const chinaLocalAuth = await findApiKeyInLocalAuth(CHINA_AUTH_KEYS);
    if (chinaLocalAuth) {
      return {
        ok: true,
        token: chinaLocalAuth.token,
        source: "local_auth",
        endpointVariant: "china",
      };
    }

    return {
      ok: false,
      reason:
        "Set MINIMAX_CODING_PLAN_API_KEY, MINIMAX_API_KEY, or MINIMAX_CHINA_CODING_PLAN_API_KEY.",
    };
  }

  async fetchQuota(
    auth: QuotaAuthOk,
    ctx: QuotaProviderContext
  ): Promise<QuotaProviderFetchResult> {
    const variant =
      auth.endpointVariant === "china"
        ? ("china" as const)
        : ("global" as const);
    const endpoint = variant === "china" ? CHINA_ENDPOINT : GLOBAL_ENDPOINT;
    const payload = await fetchJsonWithTimeout(
      this.fetchImpl,
      endpoint,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      },
      this.timeoutMs
    );

    return {
      displayName:
        variant === "china" ? "MiniMax Coding Plan (CN)" : this.displayName,
      windows: normalizeMiniMaxQuota(payload, {
        nowMs: ctx.now.getTime(),
        counterSemantics: COUNTER_SEMANTICS[variant],
      }),
    };
  }
}

export function normalizeMiniMaxQuota(
  payload: unknown,
  options: { nowMs: number; counterSemantics: CounterSemantics }
) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const remains = firstArray(
    root?.model_remains,
    data?.model_remains,
    root?.models,
    data?.models,
    root?.remains,
    data?.remains
  );
  const records = remains.length > 0 ? remains : [data, root].filter(Boolean);
  const windows: QuotaWindow[] = [];

  for (const item of records) {
    const model = asRecord(item);
    if (!model) {
      continue;
    }
    const modelName = readString(model, [
      "model_name",
      "model",
      "name",
      "modelName",
    ]);
    if (modelName && !isMiniMaxQuotaModel(modelName)) {
      continue;
    }

    const intervalWindow = buildMiniMaxWindow(model, {
      modelName,
      windowType: "5h",
      label: "5h",
      totalKeys: [
        "current_interval_total_count",
        "currentIntervalTotalCount",
        "current_interval_total",
        "currentIntervalTotal",
        "interval_total",
        "intervalTotal",
      ],
      counterKeys: [
        "current_interval_usage_count",
        "currentIntervalUsageCount",
        "current_interval_used_count",
        "currentIntervalUsedCount",
        "current_interval_usage",
        "currentIntervalUsage",
        "interval_usage_count",
        "intervalUsageCount",
        "used",
        "usage",
      ],
      remainingKeys: [
        "current_interval_remaining_count",
        "currentIntervalRemainingCount",
        "current_interval_remain_count",
        "currentIntervalRemainCount",
        "interval_remaining_count",
        "remaining",
        "remain",
      ],
      usedPercentKeys: [
        "current_interval_used_percent",
        "currentIntervalUsedPercent",
        "used_percent",
        "usedPercent",
      ],
      remainingPercentKeys: [
        "current_interval_remaining_percent",
        "currentIntervalRemainingPercent",
        "current_interval_usage_percent",
        "currentIntervalUsagePercent",
        "usage_percent",
        "usagePercent",
        "remaining_percent",
        "remainingPercent",
      ],
      resetKeys: [
        "current_interval_reset_time",
        "current_interval_reset_at",
        "interval_reset_time",
        "end_time",
        "endTime",
      ],
      resetAfterKeys: [
        "remains_time",
        "remainsTime",
        "current_interval_remains_time",
        "currentIntervalRemainsTime",
      ],
      nowMs: options.nowMs,
      counterSemantics: options.counterSemantics,
    });
    if (intervalWindow) {
      windows.push(intervalWindow);
    }

    const weeklyWindow = buildMiniMaxWindow(model, {
      modelName,
      windowType: "weekly",
      label: "Weekly",
      totalKeys: [
        "current_weekly_total_count",
        "currentWeeklyTotalCount",
        "current_weekly_total",
        "currentWeeklyTotal",
        "weekly_total",
        "weeklyTotal",
      ],
      counterKeys: [
        "current_weekly_usage_count",
        "currentWeeklyUsageCount",
        "current_weekly_used_count",
        "currentWeeklyUsedCount",
        "current_weekly_usage",
        "currentWeeklyUsage",
        "weekly_usage_count",
        "weeklyUsageCount",
      ],
      remainingKeys: [
        "current_weekly_remaining_count",
        "currentWeeklyRemainingCount",
        "current_weekly_remain_count",
        "currentWeeklyRemainCount",
        "weekly_remaining_count",
        "weeklyRemainingCount",
      ],
      usedPercentKeys: [
        "current_weekly_used_percent",
        "currentWeeklyUsedPercent",
        "weekly_used_percent",
        "weeklyUsedPercent",
      ],
      remainingPercentKeys: [
        "current_weekly_remaining_percent",
        "currentWeeklyRemainingPercent",
        "current_weekly_usage_percent",
        "currentWeeklyUsagePercent",
        "weekly_usage_percent",
        "weeklyUsagePercent",
        "weekly_remaining_percent",
        "weeklyRemainingPercent",
      ],
      resetKeys: [
        "current_weekly_reset_time",
        "current_weekly_reset_at",
        "weekly_reset_time",
        "weekly_end_time",
        "weeklyEndTime",
      ],
      resetAfterKeys: [
        "weekly_remains_time",
        "weeklyRemainsTime",
        "current_weekly_remains_time",
        "currentWeeklyRemainsTime",
      ],
      nowMs: options.nowMs,
      counterSemantics: options.counterSemantics,
    });
    if (weeklyWindow) {
      windows.push(weeklyWindow);
    }
  }

  return dedupeWindows(windows);
}

function buildMiniMaxWindow(
  model: Record<string, unknown>,
  params: {
    modelName: string | undefined;
    windowType: string;
    label: string;
    totalKeys: readonly string[];
    counterKeys: readonly string[];
    remainingKeys: readonly string[];
    usedPercentKeys: readonly string[];
    remainingPercentKeys: readonly string[];
    resetKeys: readonly string[];
    resetAfterKeys: readonly string[];
    nowMs: number;
    counterSemantics: CounterSemantics;
  }
): QuotaWindow | null {
  const total = readNumber(model, params.totalKeys);
  const counter = readNumber(model, params.counterKeys);
  const explicitRemaining = readNumber(model, params.remainingKeys);
  const usedPercent = readNumber(model, params.usedPercentKeys);
  const remainingPercent = readNumber(model, params.remainingPercentKeys);
  if (
    total === undefined &&
    counter === undefined &&
    explicitRemaining === undefined &&
    usedPercent === undefined &&
    remainingPercent === undefined
  ) {
    return null;
  }

  const hasPercentSignal =
    usedPercent !== undefined || remainingPercent !== undefined;
  const unlimited =
    total === 0 && !hasPercentSignal && explicitRemaining === undefined;
  const { remaining, used } = calculateMiniMaxCounts({
    total,
    counter,
    explicitRemaining,
    counterSemantics: params.counterSemantics,
    unlimited,
  });
  const resetAt =
    parseResetAt(readFirst(model, params.resetKeys), params.nowMs) ??
    parseResetAfterDuration(
      readFirst(model, params.resetAfterKeys),
      params.nowMs
    );
  const modelSuffix = params.modelName ? `:${params.modelName}` : "";

  return {
    id: `${params.windowType}${modelSuffix}`,
    windowType: params.windowType,
    label: params.modelName
      ? `${params.label} - ${params.modelName}`
      : params.label,
    scope: params.modelName,
    used,
    total: total && total > 0 ? total : undefined,
    remaining,
    ...(unlimited ? { unlimited: true } : {}),
    percentRemaining:
      (unlimited ? clampPercent(100) : undefined) ??
      (remainingPercent !== undefined
        ? clampPercent(remainingPercent)
        : undefined) ??
      (usedPercent !== undefined
        ? clampPercent(100 - usedPercent)
        : undefined) ??
      percentRemainingFromCounts({
        total: total && total > 0 ? total : undefined,
        remaining,
        used,
      }) ??
      (remaining !== undefined && total === undefined
        ? undefined
        : clampPercent(0)),
    resetAt,
  };
}

function numberOrUndefined(
  left: number | undefined,
  right: number | undefined,
  compute: (left: number, right: number) => number
) {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  return compute(left, right);
}

function calculateMiniMaxCounts(params: {
  total: number | undefined;
  counter: number | undefined;
  explicitRemaining: number | undefined;
  counterSemantics: CounterSemantics;
  unlimited: boolean;
}): { remaining: number | undefined; used: number | undefined } {
  const remaining =
    params.explicitRemaining ?? calculateRemainingFromCounter(params);
  const used = calculateUsedFromCounter({ ...params, remaining });
  return { remaining, used };
}

function calculateRemainingFromCounter(params: {
  total: number | undefined;
  counter: number | undefined;
  counterSemantics: CounterSemantics;
  unlimited: boolean;
}): number | undefined {
  if (params.counterSemantics === "remaining") {
    if (params.total === 0) {
      return undefined;
    }
    return params.counter;
  }
  if (params.unlimited || params.total === 0) {
    return undefined;
  }
  return numberOrUndefined(
    params.total,
    params.counter,
    (currentTotal, currentCounter) => Math.max(0, currentTotal - currentCounter)
  );
}

function calculateUsedFromCounter(params: {
  total: number | undefined;
  counter: number | undefined;
  counterSemantics: CounterSemantics;
  unlimited: boolean;
  remaining: number | undefined;
}): number | undefined {
  if (params.unlimited || params.total === 0) {
    return undefined;
  }
  if (params.counterSemantics === "used") {
    return params.counter;
  }
  return numberOrUndefined(
    params.total,
    params.remaining,
    (currentTotal, currentRemaining) =>
      Math.max(0, currentTotal - currentRemaining)
  );
}

function readFirst(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    const array = asArray(value);
    if (array.length > 0) {
      return array;
    }
  }
  return [];
}

function parseResetAfterDuration(
  value: unknown,
  nowMs: number
): string | undefined {
  const duration = readDurationMs(value);
  return duration === undefined
    ? undefined
    : new Date(nowMs + duration).toISOString();
}

function readDurationMs(value: unknown): number | undefined {
  let numeric = Number.NaN;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    numeric = Number(value);
  }
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return numeric > 604_800 ? numeric : numeric * 1000;
}

function dedupeWindows(windows: QuotaWindow[]): QuotaWindow[] {
  const seen = new Set<string>();
  const result: QuotaWindow[] = [];
  for (const window of windows) {
    if (seen.has(window.id)) {
      continue;
    }
    seen.add(window.id);
    result.push(window);
  }
  return result;
}

function firstEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = getEnvValue(key);
    if (value) {
      return value;
    }
  }
  return null;
}

function isMiniMaxQuotaModel(
  modelName: string | undefined
): modelName is string {
  if (!modelName) {
    return false;
  }
  const normalized = modelName.trim().toLowerCase();
  return (
    normalized === "general" ||
    normalized === "text" ||
    normalized === "chat" ||
    normalized === "coding" ||
    normalized.startsWith("minimax-m") ||
    normalized.startsWith("minimax-m*")
  );
}
