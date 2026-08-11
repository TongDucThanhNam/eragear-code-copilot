import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { file as bunFile } from "bun";
import { LocalCliUsageScannerAdapter } from "./local-cli-usage-scanner.adapter";
import type { PricingSnapshot } from "./usage-pricing";
import { calculateUsageCost } from "./usage-pricing";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const ORIGINAL_ZCODE_CLI_DIR = process.env.ZCODE_CLI_DIR;

afterEach(() => {
  if (ORIGINAL_CODEX_HOME === undefined) {
    process.env.CODEX_HOME = undefined;
  } else {
    process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
  }
  if (ORIGINAL_ZCODE_CLI_DIR === undefined) {
    process.env.ZCODE_CLI_DIR = undefined;
  } else {
    process.env.ZCODE_CLI_DIR = ORIGINAL_ZCODE_CLI_DIR;
  }
});

describe("LocalCliUsageScannerAdapter", () => {
  test("prices Codex gpt-5.5 usage from the models.dev snapshot", () => {
    const cost = calculateUsageCost({
      providerId: "codex",
      modelName: "gpt-5.5",
      tokens: {
        inputTokens: 150,
        outputTokens: 60,
        cacheInputTokens: 30,
        cacheOutputTokens: 0,
        totalTokens: 210,
      },
    });

    expect(cost.totalUsd).toBeCloseTo(0.002_415, 8);
    expect(cost.pricedTokens).toBe(210);
    expect(cost.unpricedTokens).toBe(0);
  });

  test("prices MiniMax model hints from the models.dev snapshot", () => {
    const cost = calculateUsageCost({
      providerId: "opencode",
      modelName: "default-minimax/MiniMax-M3",
      tokens: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheInputTokens: 100,
        cacheOutputTokens: 0,
        totalTokens: 1100,
      },
    });

    expect(cost.totalUsd).toBeCloseTo(0.000_792, 8);
    expect(cost.pricedTokens).toBe(1100);
    expect(cost.unpricedTokens).toBe(0);
  });

  test("prices ZAI coding plan GLM 5.2 usage from the bundled snapshot", () => {
    const cost = calculateUsageCost({
      providerId: "zcode",
      modelName: "zai-coding-plan/glm-5.2",
      tokens: {
        inputTokens: 120,
        outputTokens: 50,
        cacheInputTokens: 20,
        cacheOutputTokens: 0,
        totalTokens: 170,
      },
    });

    expect(cost.totalUsd).toBeCloseTo(0.000_365_2, 8);
    expect(cost.pricedTokens).toBe(170);
    expect(cost.unpricedTokens).toBe(0);
  });

  test("prices Zcode Anthropic GLM 5.2 usage through ZAI model inference", () => {
    const cost = calculateUsageCost({
      providerId: "zcode",
      modelName: "zcode-anthropic/glm-5.2",
      tokens: {
        inputTokens: 120,
        outputTokens: 50,
        cacheInputTokens: 20,
        cacheOutputTokens: 0,
        totalTokens: 170,
      },
    });

    expect(cost.totalUsd).toBeCloseTo(0.000_365_2, 8);
    expect(cost.pricedTokens).toBe(170);
    expect(cost.unpricedTokens).toBe(0);
  });

  test("prefers canonical ZAI GLM 5.2 pricing over stale zero-cost plan buckets", () => {
    const staleSnapshot: PricingSnapshot = {
      _meta: {
        source: "test",
        generatedAt: 0,
        units: "USD per 1M tokens",
      },
      providers: {
        "zai-coding-plan": {
          "glm-5.2": {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          },
        },
        zai: {
          "glm-5.2": {
            input: 1.4,
            output: 4.4,
            cache_read: 0.26,
            cache_write: 0,
          },
        },
      },
    };
    const cost = calculateUsageCost({
      providerId: "zcode",
      modelName: "zai-coding-plan/glm-5.2",
      pricingSnapshot: staleSnapshot,
      tokens: {
        inputTokens: 120,
        outputTokens: 50,
        cacheInputTokens: 20,
        cacheOutputTokens: 0,
        totalTokens: 170,
      },
    });

    expect(cost.totalUsd).toBeCloseTo(0.000_365_2, 8);
    expect(cost.pricedTokens).toBe(170);
    expect(cost.unpricedTokens).toBe(0);
  });

  test("infers canonical DeepSeek pricing for unprefixed Zcode model names", () => {
    const pricingSnapshot: PricingSnapshot = {
      _meta: {
        source: "test",
        generatedAt: 0,
        units: "USD per 1M tokens",
      },
      providers: {
        deepseek: {
          "deepseek-v4-flash": { input: 0.09, output: 0.18 },
          "deepseek-v4-pro": { input: 0.435, output: 0.87 },
        },
      },
    };
    const tokens = {
      inputTokens: 120,
      outputTokens: 50,
      cacheInputTokens: 20,
      cacheOutputTokens: 0,
      totalTokens: 170,
    };

    const flashCost = calculateUsageCost({
      providerId: "zcode",
      modelName: "deepseek-v4-flash",
      pricingSnapshot,
      tokens,
    });
    const proCost = calculateUsageCost({
      providerId: "zcode",
      modelName: "deepseek-v4-pro",
      pricingSnapshot,
      tokens,
    });

    expect(flashCost.totalUsd).toBeCloseTo(0.000_019_8, 10);
    expect(flashCost.pricedTokens).toBe(170);
    expect(flashCost.unpricedTokens).toBe(0);
    expect(proCost.totalUsd).toBeCloseTo(0.000_095_7, 10);
    expect(proCost.pricedTokens).toBe(170);
    expect(proCost.unpricedTokens).toBe(0);
  });

  test("scans Zcode SQLite usage and aggregates provider-prefixed model hints", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "eragear-zcode-usage-"));
    try {
      process.env.ZCODE_CLI_DIR = tempDir;
      const dbDir = path.join(tempDir, "db");
      const dbPath = path.join(dbDir, "db.sqlite");
      await mkdir(dbDir, { recursive: true });
      const db = new Database(dbPath);
      try {
        db.exec(`
          CREATE TABLE model_usage (
            id TEXT,
            provider_id TEXT,
            model_id TEXT,
            status TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            reasoning_tokens INTEGER,
            cache_creation_input_tokens INTEGER,
            cache_read_input_tokens INTEGER,
            computed_total_tokens INTEGER,
            provider_total_tokens INTEGER
          );
        `);
        const insertUsage = db.query(
          `INSERT INTO model_usage (
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        insertUsage.run(
          "usage_1",
          "builtin:zai-coding-plan",
          "GLM-5.2",
          "completed",
          Date.UTC(2026, 5, 10, 9),
          Date.UTC(2026, 5, 10, 9, 0, 5),
          100,
          50,
          0,
          0,
          20,
          170,
          170
        );
        insertUsage.run(
          "usage_2",
          "zcode-anthropic",
          "glm-5.2",
          "completed",
          Date.UTC(2026, 5, 10, 9, 1),
          Date.UTC(2026, 5, 10, 9, 1, 5),
          200,
          100,
          0,
          0,
          40,
          340,
          340
        );
      } finally {
        db.close();
      }

      const result = await new LocalCliUsageScannerAdapter({
        persistCodexIndex: false,
      }).scan({
        range: "all",
        providers: ["zcode"],
        startMs: Date.UTC(2026, 5, 1),
        endMs: Date.UTC(2026, 5, 12),
      });

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]?.providerDisplayName).toBe("Zcode Agent");
      expect(result.providers[0]?.status).toBe("ready");
      expect(result.totals.totalTokens).toBe(510);
      expect(result.totals.inputTokens).toBe(360);
      expect(result.totals.outputTokens).toBe(150);
      expect(result.totals.cacheInputTokens).toBe(60);
      expect(result.modelUsage).toHaveLength(2);
      expect(
        result.modelUsage.map((model) => model.upstreamProviderId).sort()
      ).toEqual(["anthropic", "zai"]);
      expect(
        result.modelUsage.reduce((sum, model) => sum + model.cost.totalUsd, 0)
      ).toBeCloseTo(result.cost.totalUsd, 12);
      expect(result.providers[0]?.modelUsage).toHaveLength(2);
      expect(result.daily[0]?.breakdown).toHaveLength(2);
      expect(result.pricing.pricedTokens).toBe(510);
      expect(result.pricing.unpricedTokens).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("scans Codex JSONL token deltas and model usage", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "eragear-codex-usage-"));
    try {
      process.env.CODEX_HOME = tempDir;
      const sessionsDir = path.join(tempDir, "sessions", "2026", "06");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(
        path.join(sessionsDir, "session.jsonl"),
        [
          JSON.stringify({
            type: "turn_context",
            timestamp: "2026-06-10T09:00:00.000Z",
            payload: { model: "gpt-5-20250601" },
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-10T09:00:02.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 100,
                  cached_input_tokens: 20,
                  output_tokens: 40,
                  total_tokens: 140,
                },
              },
            },
          }),
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-10T09:00:04.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 150,
                  cached_input_tokens: 30,
                  output_tokens: 60,
                  total_tokens: 210,
                },
              },
            },
          }),
        ].join("\n")
      );

      const result = await new LocalCliUsageScannerAdapter({
        persistCodexIndex: false,
      }).scan({
        range: "all",
        providers: ["codex"],
        startMs: Date.UTC(2026, 5, 1),
        endMs: Date.UTC(2026, 5, 12),
      });

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]?.status).toBe("ready");
      expect(result.totals.totalTokens).toBe(210);
      expect(result.totals.inputTokens).toBe(150);
      expect(result.totals.outputTokens).toBe(60);
      expect(result.modelUsage[0]?.name).toBe("gpt-5");
      expect(result.modelUsage[0]?.upstreamProviderId).toBe("openai");
      expect(result.modelUsage[0]?.tokens.totalTokens).toBe(210);
      expect(result.modelUsage[0]?.cost.totalUsd).toBeCloseTo(0.000_753_75, 8);
      expect(result.cost.totalUsd).toBeCloseTo(0.000_753_75, 8);
      expect(result.pricing.pricedTokens).toBe(210);
      expect(result.pricing.unpricedTokens).toBe(0);
      expect(result.daily[0]?.tokens.totalTokens).toBe(210);
      expect(result.daily[0]?.cost.totalUsd).toBeCloseTo(0.000_753_75, 8);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("backfills a sole late model only for Codex subagent logs", async () => {
    const tempDir = await mkdtemp(
      path.join(tmpdir(), "eragear-codex-subagent-")
    );
    try {
      process.env.CODEX_HOME = tempDir;
      const sessionsDir = path.join(tempDir, "sessions", "2026", "06");
      await mkdir(sessionsDir, { recursive: true });
      const tokenCount = (totalTokens: number) =>
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-10T09:00:02.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: totalTokens - 40,
                cached_input_tokens: 20,
                output_tokens: 40,
                total_tokens: totalTokens,
              },
            },
          },
        });
      const lateContext = JSON.stringify({
        type: "turn_context",
        timestamp: "2026-06-10T09:00:04.000Z",
        payload: { model: "gpt-5-20250601" },
      });
      await writeFile(
        path.join(sessionsDir, "subagent.jsonl"),
        [
          JSON.stringify({
            type: "session_meta",
            timestamp: "2026-06-10T09:00:00.000Z",
            payload: { thread_source: "subagent" },
          }),
          tokenCount(140),
          lateContext,
        ].join("\n")
      );
      await writeFile(
        path.join(sessionsDir, "main.jsonl"),
        [tokenCount(70), lateContext].join("\n")
      );

      const result = await new LocalCliUsageScannerAdapter({
        persistCodexIndex: false,
      }).scan({
        range: "all",
        providers: ["codex"],
        startMs: Date.UTC(2026, 5, 1),
        endMs: Date.UTC(2026, 5, 12),
      });

      expect(result.totals.totalTokens).toBe(210);
      expect(result.modelUsage).toHaveLength(1);
      expect(result.modelUsage[0]?.name).toBe("gpt-5");
      expect(result.modelUsage[0]?.tokens.totalTokens).toBe(140);
      expect(result.pricing.pricedTokens).toBe(140);
      expect(result.pricing.unpricedTokens).toBe(70);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("persists a prompt-free Codex usage index and invalidates changed files", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "eragear-codex-index-"));
    try {
      process.env.CODEX_HOME = tempDir;
      const sessionsDir = path.join(tempDir, "sessions", "2026", "06");
      const sessionPath = path.join(sessionsDir, "session.jsonl");
      const indexPath = path.join(tempDir, "usage-index.json");
      await mkdir(sessionsDir, { recursive: true });
      const initialLines = [
        JSON.stringify({
          type: "turn_context",
          timestamp: "2026-06-10T09:00:00.000Z",
          payload: { model: "gpt-5-20250601" },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-06-10T09:00:01.000Z",
          payload: { text: "SECRET_PROMPT_MUST_NOT_BE_CACHED" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-10T09:00:02.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 40,
                total_tokens: 140,
              },
            },
          },
        }),
      ];
      await writeFile(sessionPath, initialLines.join("\n"));
      const scanInput = {
        range: "all" as const,
        providers: ["codex" as const],
        startMs: Date.UTC(2026, 5, 1),
        endMs: Date.UTC(2026, 5, 12),
      };

      const first = await new LocalCliUsageScannerAdapter({
        codexIndexFilePath: () => indexPath,
      }).scan(scanInput);
      const persistedIndex = await bunFile(indexPath).text();

      expect(first.totals.totalTokens).toBe(140);
      expect(persistedIndex).toContain('"version":3');
      expect(persistedIndex).not.toContain("SECRET_PROMPT_MUST_NOT_BE_CACHED");

      await writeFile(
        sessionPath,
        [
          ...initialLines,
          JSON.stringify({
            type: "event_msg",
            timestamp: "2026-06-10T09:00:04.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  input_tokens: 150,
                  cached_input_tokens: 30,
                  output_tokens: 60,
                  total_tokens: 210,
                },
              },
            },
          }),
        ].join("\n")
      );

      const refreshed = await new LocalCliUsageScannerAdapter({
        codexIndexFilePath: () => indexPath,
      }).scan(scanInput);
      expect(refreshed.totals.totalTokens).toBe(210);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
