import { describe, expect, test } from "bun:test";
import { readOAuthTokenFromEntry } from "./local-auth";
import {
  MiniMaxQuotaAdapter,
  normalizeMiniMaxQuota,
} from "./minimax-quota.adapter";
import { normalizeOpenAIQuota } from "./openai-chatgpt-quota.adapter";
import { normalizeZaiQuota, ZaiQuotaAdapter } from "./zai-quota.adapter";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

describe("quota adapter normalizers", () => {
  test("normalizes MiniMax global counters as remaining quota", () => {
    const windows = normalizeMiniMaxQuota(
      {
        model_remains: [
          {
            model_name: "MiniMax-M1",
            current_interval_total_count: 100,
            current_interval_usage_count: 40,
            current_weekly_total_count: 1000,
            current_weekly_usage_count: 250,
          },
        ],
      },
      { nowMs: NOW_MS, counterSemantics: "remaining" }
    );

    expect(windows[0]).toMatchObject({
      windowType: "5h",
      remaining: 40,
      used: 60,
      percentRemaining: 40,
    });
    expect(windows[1]).toMatchObject({
      windowType: "weekly",
      remaining: 250,
      used: 750,
      percentRemaining: 25,
    });
  });

  test("normalizes MiniMax CN counters as used quota", () => {
    const windows = normalizeMiniMaxQuota(
      {
        model_remains: [
          {
            model_name: "minimax-m1",
            current_interval_total_count: 100,
            current_interval_usage_count: 40,
          },
        ],
      },
      { nowMs: NOW_MS, counterSemantics: "used" }
    );

    expect(windows[0]).toMatchObject({
      remaining: 60,
      used: 40,
      percentRemaining: 60,
    });
  });

  test("normalizes MiniMax token-plan 5h and unlimited weekly windows", () => {
    const windows = normalizeMiniMaxQuota(
      {
        model_remains: [
          {
            start_time: 1_778_616_000_000,
            end_time: 1_778_630_400_000,
            remains_time: 12_241_883,
            current_interval_total_count: 1500,
            current_interval_usage_count: 151,
            model_name: "MiniMax-M*",
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            weekly_start_time: 1_778_457_600_000,
            weekly_end_time: 1_779_062_400_000,
            weekly_remains_time: 444_241_883,
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
      },
      { nowMs: NOW_MS, counterSemantics: "used" }
    );

    expect(windows[0]).toMatchObject({
      windowType: "5h",
      used: 151,
      remaining: 1349,
      total: 1500,
      percentRemaining: 89.933_333_333_333_34,
      resetAt: "2026-05-13T00:00:00.000Z",
    });
    expect(windows[1]).toMatchObject({
      windowType: "weekly",
      unlimited: true,
      percentRemaining: 100,
      resetAt: "2026-05-18T00:00:00.000Z",
    });
  });

  test("normalizes MiniMax time-based general quota percent windows", () => {
    const windows = normalizeMiniMaxQuota(
      {
        model_remains: [
          {
            model_name: "general",
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            current_interval_remaining_percent: 99,
            current_weekly_remaining_percent: 96,
            remains_time: 14_998_196,
            weekly_remains_time: 547_798_196,
          },
        ],
      },
      { nowMs: NOW_MS, counterSemantics: "used" }
    );

    expect(windows[0]).toMatchObject({
      windowType: "5h",
      percentRemaining: 99,
      scope: "general",
    });
    expect(windows[0]?.unlimited).toBeUndefined();
    expect(windows[0]?.total).toBeUndefined();
    expect(windows[1]).toMatchObject({
      windowType: "weekly",
      percentRemaining: 96,
      scope: "general",
    });
    expect(windows[1]?.unlimited).toBeUndefined();
    expect(windows[1]?.total).toBeUndefined();
  });

  test("normalizes Z.ai token and MCP limits", () => {
    const windows = normalizeZaiQuota(
      {
        data: {
          limits: [
            {
              type: "TOKENS_LIMIT",
              unit: 3,
              number: 100,
              usage: 20,
              percentage: 20,
            },
            {
              type: "TIME_LIMIT",
              unit: 0,
              number: 60,
              usage: 15,
              percentage: 25,
            },
          ],
        },
      },
      NOW_MS
    );

    expect(windows).toEqual([
      expect.objectContaining({
        id: "5h",
        percentRemaining: 80,
        remaining: 80,
      }),
      expect.objectContaining({
        id: "mcp",
        percentRemaining: 75,
        remaining: 45,
      }),
    ]);
  });

  test("normalizes OpenAI ChatGPT rate limit windows", () => {
    const windows = normalizeOpenAIQuota(
      {
        rate_limit: {
          primary_window: {
            used_percent: 75,
            reset_after_seconds: 60,
          },
          secondary_window: {
            used_percent: 20,
          },
        },
      },
      NOW_MS
    );

    expect(windows[0]).toMatchObject({
      id: "primary",
      percentRemaining: 25,
      resetAt: "2026-06-12T12:01:00.000Z",
    });
    expect(windows[1]).toMatchObject({
      id: "secondary",
      percentRemaining: 80,
    });
  });

  test("reads Codex CLI top-level OAuth token cache", () => {
    const token = readOAuthTokenFromEntry({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id-token",
        access_token: "access-token",
        refresh_token: "refresh-token",
        account_id: "account-1",
      },
      last_refresh: "2026-06-13T00:00:00.000Z",
    });

    expect(token).toEqual({
      token: "access-token",
      accountId: "account-1",
    });
  });

  test("resolves Z.ai auth from app-stored credentials", async () => {
    await withClearedEnv(
      ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"],
      async () => {
        const adapter = new ZaiQuotaAdapter();
        const seenProviderIds: string[][] = [];

        const auth = await adapter.resolveAuth({
          userId: "user-1",
          agents: [],
          now: new Date(NOW_MS),
          credentialResolver: {
            resolveFirst: (userId, input) => {
              expect(userId).toBe("user-1");
              seenProviderIds.push([...input.providerIds]);
              return Promise.resolve({
                credentialId: "cred-zai",
                providerId: "builtin:zai-coding-plan",
                name: "ZAI",
                kind: "api_key",
                secret: "zai-secret",
              });
            },
          },
        });

        expect(seenProviderIds[0]).toContain("builtin:zai-coding-plan");
        expect(auth).toEqual({
          ok: true,
          token: "zai-secret",
          source: "credential",
        });
      }
    );
  });

  test("resolves MiniMax global auth from app-stored credentials", async () => {
    await withClearedEnv(
      [
        "MINIMAX_CODING_PLAN_API_KEY",
        "MINIMAX_API_KEY",
        "MINIMAX_CHINA_CODING_PLAN_API_KEY",
      ],
      async () => {
        const adapter = new MiniMaxQuotaAdapter();
        const auth = await adapter.resolveAuth({
          userId: "user-1",
          agents: [],
          now: new Date(NOW_MS),
          credentialResolver: {
            resolveFirst: (_userId, input) => {
              if (!input.providerIds.includes("default-minimax")) {
                return Promise.resolve(null);
              }
              return Promise.resolve({
                credentialId: "cred-minimax",
                providerId: "default-minimax",
                name: "MiniMax",
                kind: "api_key",
                secret: "minimax-secret",
              });
            },
          },
        });

        expect(auth).toEqual({
          ok: true,
          token: "minimax-secret",
          source: "credential",
          endpointVariant: "global",
        });
      }
    );
  });
});

async function withClearedEnv<T>(
  keys: readonly string[],
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
