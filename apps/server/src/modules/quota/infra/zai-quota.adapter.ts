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
  readNumber,
  readString,
} from "./quota-adapter-utils";

const ZAI_ENDPOINT = "https://api.z.ai/api/monitor/usage/quota/limit";
const REQUEST_TIMEOUT_MS = 10_000;
const ZAI_ENV_KEYS = ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"] as const;
const ZAI_AUTH_KEYS = [
  "zai",
  "z.ai",
  "zai-coding-plan",
  "glm",
  "builtin:zai-coding-plan",
  "builtin:zai",
] as const;
const ZAI_CREDENTIAL_NAMES = [
  "Z.ai Coding Plan",
  "Z.AI - Coding Plan",
  "Z.AI - API Key",
] as const;
const API_KEY_CREDENTIAL_KINDS = ["api_key", "bearer_token"] as const;

export class ZaiQuotaAdapter implements QuotaProviderAdapter {
  readonly id = "zai";
  readonly aliases = [...ZAI_AUTH_KEYS];
  readonly displayName = "Z.ai Coding Plan";
  readonly source = "remote_api" as const;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  detect(ctx: QuotaProviderContext): boolean {
    return (
      hasEnvValue(ZAI_ENV_KEYS) || agentsMatchProvider(ctx.agents, this.aliases)
    );
  }

  async resolveAuth(ctx: QuotaProviderContext): Promise<QuotaAuthResult> {
    const envToken = firstEnvValue(ZAI_ENV_KEYS);
    if (envToken) {
      return { ok: true, token: envToken, source: "env" };
    }

    const credential = await ctx.credentialResolver?.resolveFirst(ctx.userId, {
      providerIds: ZAI_AUTH_KEYS,
      names: ZAI_CREDENTIAL_NAMES,
      kinds: API_KEY_CREDENTIAL_KINDS,
    });
    if (credential) {
      return {
        ok: true,
        token: credential.secret,
        source: "credential",
      };
    }

    const localAuth = await findApiKeyInLocalAuth(ZAI_AUTH_KEYS);
    if (localAuth) {
      return {
        ok: true,
        token: localAuth.token,
        source: "local_auth",
      };
    }

    return {
      ok: false,
      reason: "Set ZAI_API_KEY or ZAI_CODING_PLAN_API_KEY.",
    };
  }

  async fetchQuota(
    auth: QuotaAuthOk,
    ctx: QuotaProviderContext
  ): Promise<QuotaProviderFetchResult> {
    const payload = await fetchJsonWithTimeout(
      this.fetchImpl,
      ZAI_ENDPOINT,
      {
        method: "GET",
        headers: {
          Authorization: auth.token,
          "Content-Type": "application/json",
        },
      },
      this.timeoutMs
    );

    return {
      windows: normalizeZaiQuota(payload, ctx.now.getTime()),
    };
  }
}

export function normalizeZaiQuota(payload: unknown, nowMs: number) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const limits = asArray(data?.limits);
  const windows: QuotaWindow[] = [];

  for (const item of limits) {
    const limit = asRecord(item);
    if (!limit) {
      continue;
    }
    const type = readString(limit, ["type"]);
    const unit = readNumber(limit, ["unit"]);
    const windowMeta = getZaiWindowMeta(type, unit);
    if (!windowMeta) {
      continue;
    }

    const total = readNumber(limit, ["number", "total", "limit"]);
    const used = readNumber(limit, ["usage", "used"]);
    const percentage = readNumber(limit, ["percentage", "usedPercent"]);
    const percentRemaining = calculatePercentRemaining({
      percentage,
      total,
      used,
    });
    const remaining =
      total !== undefined && used !== undefined
        ? Math.max(0, total - used)
        : undefined;

    windows.push({
      id: windowMeta.id,
      windowType: windowMeta.id,
      label: windowMeta.label,
      used,
      total,
      remaining,
      percentRemaining,
      resetAt: parseResetAt(
        limit.nextResetTime ?? limit.next_reset_time ?? limit.resetAt,
        nowMs
      ),
    });
  }

  return windows;
}

function calculatePercentRemaining(params: {
  percentage?: number;
  total?: number;
  used?: number;
}): number | undefined {
  if (params.percentage !== undefined) {
    return clampPercent(100 - params.percentage);
  }
  if (
    params.total !== undefined &&
    params.used !== undefined &&
    params.total > 0
  ) {
    return clampPercent(100 - (params.used / params.total) * 100);
  }
  return undefined;
}

function getZaiWindowMeta(type: string | undefined, unit: number | undefined) {
  if (type === "TIME_LIMIT") {
    return { id: "mcp", label: "MCP" };
  }
  if (type !== "TOKENS_LIMIT") {
    return null;
  }
  if (unit === 3) {
    return { id: "5h", label: "5h" };
  }
  if (unit === 4) {
    return { id: "daily", label: "Daily" };
  }
  if (unit === 6) {
    return { id: "weekly", label: "Weekly" };
  }
  return null;
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
