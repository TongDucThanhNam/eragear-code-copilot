import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalCliUsageScannerAdapter } from "./local-cli-usage-scanner.adapter";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;

afterEach(() => {
  if (ORIGINAL_CODEX_HOME === undefined) {
    process.env.CODEX_HOME = undefined;
  } else {
    process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
  }
});

describe("LocalCliUsageScannerAdapter", () => {
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

      const result = await new LocalCliUsageScannerAdapter().scan({
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
      expect(result.modelUsage[0]?.tokens.totalTokens).toBe(210);
      expect(result.daily[0]?.tokens.totalTokens).toBe(210);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
