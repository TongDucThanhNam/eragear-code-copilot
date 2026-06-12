import { describe, expect, test } from "bun:test";
import {
  estimateTextTokens,
  LocalContextUsageEstimatorAdapter,
} from "./local-context-usage-estimator.adapter";

describe("LocalContextUsageEstimatorAdapter", () => {
  test("estimates plain text token counts deterministically", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("hello world")).toBeGreaterThanOrEqual(2);
    expect(estimateTextTokens("xin chao, 世界")).toBeGreaterThanOrEqual(4);
  });

  test("resolves known model context windows through tokenlens", () => {
    const adapter = new LocalContextUsageEstimatorAdapter();

    const window = adapter.resolveContextWindow({ modelId: "gpt-4o" });

    expect(window.source).toBe("tokenlens");
    expect(window.maxTokens).toBeGreaterThanOrEqual(100_000);
  });

  test("falls back for unknown model ids", () => {
    const adapter = new LocalContextUsageEstimatorAdapter();

    const window = adapter.resolveContextWindow({
      modelId: "private-local-model",
    });

    expect(window).toEqual({
      maxTokens: 128_000,
      source: "fallback",
    });
  });
});
