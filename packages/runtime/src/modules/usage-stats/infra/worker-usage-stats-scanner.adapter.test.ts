import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { write } from "bun";
import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type {
  UsageStatsScannerInput,
  UsageStatsScannerPort,
} from "../application/ports/usage-stats-scanner.port";
import { WorkerUsageStatsScannerAdapter } from "./worker-usage-stats-scanner.adapter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("WorkerUsageStatsScannerAdapter", () => {
  test("runs scans through a Bun worker and returns its structured result", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "eragear-usage-worker-")
    );
    temporaryDirectories.push(directory);
    const entrypoint = path.join(directory, "worker.ts");
    await write(
      entrypoint,
      `self.onmessage = (event) => {
        const request = event.data;
        self.postMessage({
          kind: "usage_stats_scan",
          id: request.id,
          result: {
            range: request.input.range,
            providers: [],
            totals: {},
            cost: {},
            pricing: {},
            daily: [],
            modelUsage: [],
            activeDays: 0,
            currentStreak: 0,
            longestStreak: 0,
            warnings: [],
            checkedAt: request.input.endMs
          }
        });
      };`
    );
    const scanner = new WorkerUsageStatsScannerAdapter({
      entrypointResolver: () => entrypoint,
    });

    const result = await scanner.scan({ range: "30d", endMs: 1234 });

    expect(result.checkedAt).toBe(1234);
    expect(result.range).toBe("30d");
    scanner.close();
  });

  test("uses the direct scanner fallback when the worker cannot start", async () => {
    const fallback = new FixedScanner();
    const scanner = new WorkerUsageStatsScannerAdapter({
      entrypointResolver: () => {
        throw new Error("missing worker");
      },
      fallback,
    });

    const result = await scanner.scan({ range: "7d", endMs: 55 });

    expect(result.checkedAt).toBe(55);
    expect(fallback.calls).toBe(1);
  });
});

class FixedScanner implements UsageStatsScannerPort {
  calls = 0;

  scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary> {
    this.calls += 1;
    return Promise.resolve({
      range: input.range,
      checkedAt: input.endMs,
    } as UsageStatsCliSummary);
  }
}
