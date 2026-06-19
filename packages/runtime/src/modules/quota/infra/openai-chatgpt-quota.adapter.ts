import type { QuotaWindow } from "../application/contracts/quota.contract";
import type {
  QuotaAuthOk,
  QuotaAuthResult,
  QuotaProviderAdapter,
  QuotaProviderContext,
  QuotaProviderFetchResult,
} from "../application/ports/quota-provider.port";
import { findOAuthTokenInLocalAuth } from "./local-auth";
import {
  agentsMatchProvider,
  asRecord,
  clampPercent,
  type FetchLike,
  fetchJsonWithTimeout,
  getEnvValue,
  hasEnvValue,
  parseResetAfterSeconds,
  parseResetAt,
  readNumber,
  readString,
} from "./quota-adapter-utils";

const OPENAI_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10_000;
const OPENAI_TOKEN_ENV_KEYS = [
  "OPENAI_CHATGPT_ACCESS_TOKEN",
  "CHATGPT_ACCESS_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "OPENCODE_OPENAI_ACCESS_TOKEN",
] as const;
const OPENAI_ACCOUNT_ENV_KEYS = [
  "OPENAI_CHATGPT_ACCOUNT_ID",
  "CHATGPT_ACCOUNT_ID",
  "CODEX_ACCOUNT_ID",
] as const;
const OPENAI_AUTH_KEYS = ["openai", "codex", "chatgpt", "opencode"] as const;

export class OpenAIChatGPTQuotaAdapter implements QuotaProviderAdapter {
  readonly id = "openai";
  readonly aliases = ["openai", "chatgpt", "codex"];
  readonly displayName = "OpenAI / ChatGPT";
  readonly source = "remote_api" as const;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  detect(ctx: QuotaProviderContext): boolean {
    return (
      hasEnvValue(OPENAI_TOKEN_ENV_KEYS) ||
      agentsMatchProvider(ctx.agents, this.aliases)
    );
  }

  async resolveAuth(_ctx: QuotaProviderContext): Promise<QuotaAuthResult> {
    const envToken = firstEnvValue(OPENAI_TOKEN_ENV_KEYS);
    if (envToken) {
      return {
        ok: true,
        token: envToken,
        source: "env",
        accountId: firstEnvValue(OPENAI_ACCOUNT_ENV_KEYS) ?? undefined,
      };
    }

    const localAuth = await findOAuthTokenInLocalAuth(OPENAI_AUTH_KEYS);
    if (localAuth) {
      return {
        ok: true,
        token: localAuth.token,
        source: "local_auth",
        accountId: localAuth.accountId,
      };
    }

    return {
      ok: false,
      reason:
        "OpenAI/Codex quota requires a ChatGPT OAuth access token, not a Platform API key.",
    };
  }

  async fetchQuota(
    auth: QuotaAuthOk,
    ctx: QuotaProviderContext
  ): Promise<QuotaProviderFetchResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
    };
    if (auth.accountId) {
      headers["ChatGPT-Account-Id"] = auth.accountId;
    }

    const payload = await fetchJsonWithTimeout(
      this.fetchImpl,
      OPENAI_USAGE_ENDPOINT,
      {
        method: "GET",
        headers,
      },
      this.timeoutMs
    );

    return {
      displayName: normalizeOpenAIDisplayName(payload) ?? this.displayName,
      windows: normalizeOpenAIQuota(payload, ctx.now.getTime()),
    };
  }
}

export function normalizeOpenAIQuota(payload: unknown, nowMs: number) {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const windows: QuotaWindow[] = [];
  const rateLimit = asRecord(root.rate_limit);
  const primary = asRecord(rateLimit?.primary_window);
  if (primary) {
    windows.push(buildOpenAIWindow(primary, "primary", "Primary", nowMs));
  }
  const secondary = asRecord(rateLimit?.secondary_window);
  if (secondary) {
    windows.push(buildOpenAIWindow(secondary, "secondary", "Secondary", nowMs));
  }

  const codeReview = asRecord(root.code_review_rate_limit);
  if (codeReview) {
    windows.push(
      buildOpenAIWindow(codeReview, "code_review", "Code review", nowMs)
    );
  }

  const credits = asRecord(root.credits);
  if (credits) {
    const total = readNumber(credits, ["total", "limit", "granted"]);
    const used = readNumber(credits, ["used"]);
    const remaining = readNumber(credits, ["remaining", "available"]);
    windows.push({
      id: "credits",
      windowType: "credits",
      label: "Credits",
      used,
      total,
      remaining,
      percentRemaining: calculatePercentRemaining({ total, used, remaining }),
      resetAt: parseResetAt(credits.reset_at ?? credits.resetAt, nowMs),
    });
  }

  return windows.filter((window) => hasQuotaSignal(window));
}

function buildOpenAIWindow(
  window: Record<string, unknown>,
  id: string,
  label: string,
  nowMs: number
): QuotaWindow {
  const usedPercent = readNumber(window, [
    "used_percent",
    "usedPercent",
    "percentage",
  ]);
  const total = readNumber(window, ["total", "limit"]);
  const used = readNumber(window, ["used", "current"]);
  const remaining = readNumber(window, ["remaining", "available"]);
  return {
    id,
    windowType: id,
    label,
    used,
    total,
    remaining,
    percentRemaining: calculatePercentRemaining({
      usedPercent,
      total,
      used,
      remaining,
    }),
    resetAt:
      parseResetAt(window.reset_at ?? window.resetAt, nowMs) ??
      parseResetAfterSeconds(
        window.reset_after_seconds ?? window.resetAfterSeconds,
        nowMs
      ),
  };
}

function calculatePercentRemaining(params: {
  usedPercent?: number;
  total?: number;
  used?: number;
  remaining?: number;
}): number | undefined {
  if (params.usedPercent !== undefined) {
    return clampPercent(100 - params.usedPercent);
  }
  if (params.total === undefined || params.total <= 0) {
    return undefined;
  }
  const remaining =
    params.remaining ?? Math.max(0, params.total - (params.used ?? 0));
  return clampPercent((remaining / params.total) * 100);
}

function hasQuotaSignal(window: {
  percentRemaining?: number;
  used?: number;
  total?: number;
  remaining?: number;
  resetAt?: string;
}) {
  return (
    window.percentRemaining !== undefined ||
    window.used !== undefined ||
    window.total !== undefined ||
    window.remaining !== undefined ||
    window.resetAt !== undefined
  );
}

function normalizeOpenAIDisplayName(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }
  const planType = readString(root, ["plan_type", "planType"]);
  return planType ? `OpenAI / ChatGPT (${planType})` : undefined;
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
