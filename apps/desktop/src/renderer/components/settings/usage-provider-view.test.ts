import { describe, expect, test } from "bun:test";
import {
  buildProviderCentricUsage,
  type ProviderUsageInput,
  type UsageCostTotalsView,
  type UsageModelInput,
  type UsageTokenTotalsView,
} from "./usage-provider-view";

const AGENT_LABEL_RE = /agent|code$/i;

describe("buildProviderCentricUsage", () => {
  test("groups the same OpenAI model across coding agents", () => {
    const codex = model({
      name: "gpt-5.6-sol",
      providerId: "codex",
      providerDisplayName: "Codex",
      upstreamProviderId: "openai",
      tokens: 120,
      cost: 1.2,
    });
    const pi = model({
      name: "gpt-5.6-sol",
      providerId: "pi",
      providerDisplayName: "Pi Coding Agent",
      tokens: 80,
      cost: 0.8,
    });
    const view = buildProviderCentricUsage(usage([codex, pi]));

    expect(view.providers).toHaveLength(1);
    expect(view.providers[0]).toMatchObject({
      providerId: "openai",
      providerDisplayName: "OpenAI / ChatGPT (pro)",
      modelCount: 1,
      totals: { totalTokens: 200 },
      cost: { totalUsd: 2 },
    });
    expect(view.modelUsage).toHaveLength(1);
    expect(view.modelUsage[0]).toMatchObject({
      key: "gpt-5.6-sol",
      displayName: "gpt-5.6-sol",
      providerId: "openai",
      providerDisplayName: "OpenAI / ChatGPT (pro)",
      tokens: { totalTokens: 200 },
      cost: { totalUsd: 2 },
    });
    expect(view.daily[0]?.providers).toHaveLength(1);
    expect(view.daily[0]?.providers[0]).toMatchObject({
      providerId: "openai",
      totals: { totalTokens: 200 },
    });
  });

  test("keeps the GLM offpeak plan as a separately labeled model", () => {
    const zai = model({
      name: "glm-5.2",
      providerId: "zcode",
      providerDisplayName: "Zcode Agent",
      upstreamProviderId: "builtin:zai-coding-plan",
      tokens: 639_338_488,
      cost: 95.98,
    });
    const offpeak = model({
      name: "glm-5.2",
      providerId: "zcode",
      providerDisplayName: "Zcode Agent",
      upstreamProviderId: "offpeak-idle-plan",
      tokens: 234_324_587,
      cost: 29.22,
    });
    const view = buildProviderCentricUsage(usage([zai, offpeak]));

    expect(
      view.providers.map((provider) => provider.providerDisplayName)
    ).toEqual(["Z.ai Coding Plan", "Offpeak Idle Plan"]);
    expect(view.modelUsage).toHaveLength(2);
    expect(view.modelUsage.map((entry) => entry.displayName).sort()).toEqual([
      "glm-5.2",
      "glm-5.2 — Offpeak Idle Plan",
    ]);
    expect(
      view.modelUsage.find((entry) =>
        entry.displayName.endsWith("Offpeak Idle Plan")
      )
    ).toMatchObject({
      providerId: "offpeak-idle-plan",
      providerDisplayName: "Offpeak Idle Plan",
      tokens: { totalTokens: 234_324_587 },
    });
  });

  test("does not expose coding-agent names in provider rows", () => {
    const view = buildProviderCentricUsage(
      usage([
        model({
          name: "claude-opus-4-8",
          providerId: "claude",
          providerDisplayName: "Claude Code",
          upstreamProviderId: "anthropic",
          tokens: 50,
          cost: 5,
        }),
        model({
          name: "glm-5.2",
          providerId: "zcode",
          providerDisplayName: "Zcode Agent",
          upstreamProviderId: "zai",
          tokens: 40,
          cost: 4,
        }),
      ])
    );

    expect(
      view.providers.map((provider) => provider.providerDisplayName)
    ).toEqual(["Anthropic / Claude", "Z.ai Coding Plan"]);
    expect(
      view.providers.some((provider) =>
        AGENT_LABEL_RE.test(provider.providerDisplayName)
      )
    ).toBe(false);
  });

  test("infers the real provider when Zcode stores an opaque route id", () => {
    const view = buildProviderCentricUsage(
      usage([
        model({
          name: "deepseek-v4-pro",
          providerId: "zcode",
          providerDisplayName: "Zcode Agent",
          upstreamProviderId: "91297e57-5954-46e9-826b-cddf4149031c",
          tokens: 54_109_449,
          cost: 3.25,
        }),
      ])
    );

    expect(view.providers[0]).toMatchObject({
      providerId: "deepseek",
      providerDisplayName: "DeepSeek",
      modelCount: 1,
    });
  });
});

function usage(models: UsageModelInput[]): ProviderUsageInput {
  const totals = emptyTokens();
  const cost = emptyCost();
  for (const entry of models) {
    addTokens(totals, entry.tokens);
    addCost(cost, entry.cost);
  }
  return {
    totals,
    cost,
    modelUsage: models,
    daily: [
      {
        date: "2026-08-15",
        tokens: { ...totals },
        cost: { ...cost },
        displayTokens: totals.totalTokens,
        breakdown: models,
      },
    ],
  };
}

function model(input: {
  name: string;
  providerId: string;
  providerDisplayName: string;
  upstreamProviderId?: string;
  tokens: number;
  cost: number;
}): UsageModelInput {
  return {
    name: input.name,
    providerId: input.providerId,
    providerDisplayName: input.providerDisplayName,
    ...(input.upstreamProviderId
      ? { upstreamProviderId: input.upstreamProviderId }
      : {}),
    tokens: {
      inputTokens: input.tokens,
      outputTokens: 0,
      cacheInputTokens: 0,
      cacheOutputTokens: 0,
      totalTokens: input.tokens,
    },
    cost: {
      inputUsd: input.cost,
      outputUsd: 0,
      cacheInputUsd: 0,
      cacheOutputUsd: 0,
      totalUsd: input.cost,
      pricedTokens: input.tokens,
      unpricedTokens: 0,
    },
  };
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
