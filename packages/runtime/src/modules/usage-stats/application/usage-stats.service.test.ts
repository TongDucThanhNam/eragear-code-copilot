import { describe, expect, test } from "bun:test";
import type {
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "./contracts/usage-stats.contract";
import type {
  MutableUsageTelemetrySettingsSnapshot,
  UsageStatsRepositoryPort,
  UsageTelemetrySettingsSnapshot,
} from "./ports/usage-stats-repository.port";
import { UsageStatsService } from "./usage-stats.service";

class InMemoryUsageStatsRepo implements UsageStatsRepositoryPort {
  records: UsageStatsRecord[] = [];
  telemetry: UsageTelemetrySettings | null = null;

  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord> {
    this.records.push(record);
    return Promise.resolve(record);
  }

  listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]> {
    const filtered = this.records
      .filter((record) => record.userId === userId)
      .filter(
        (record) =>
          input?.sinceMs === undefined || record.createdAt >= input.sinceMs
      );
    return Promise.resolve(
      input?.limit === undefined ? filtered : filtered.slice(0, input.limit)
    );
  }

  readTelemetrySettings<T>(
    _userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    return Promise.resolve(
      reader(createTelemetrySettingsSnapshot(this.telemetry))
    );
  }

  async mutateTelemetrySettings<T>(
    _userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T> {
    const snapshot = createMutableTelemetrySettingsSnapshot(this.telemetry);
    const result = await mutator(snapshot);
    this.telemetry = snapshot.getNext();
    return result;
  }
}

function createTelemetrySettingsSnapshot(
  settings: UsageTelemetrySettings | null
): UsageTelemetrySettingsSnapshot {
  return {
    get() {
      return settings ? { ...settings } : null;
    },
  };
}

function createMutableTelemetrySettingsSnapshot(
  settings: UsageTelemetrySettings | null
): MutableUsageTelemetrySettingsSnapshot & {
  getNext(): UsageTelemetrySettings | null;
} {
  let next = settings ? { ...settings } : null;
  return {
    get() {
      return next ? { ...next } : null;
    },
    set(settings) {
      next = { ...settings };
    },
    getNext() {
      return next ? { ...next } : null;
    },
  };
}

describe("UsageStatsService", () => {
  test("records lifecycle and quota events into usage summary", async () => {
    const repo = new InMemoryUsageStatsRepo();
    const service = new UsageStatsService({
      repository: repo,
      nowMs: () => Date.UTC(2026, 5, 12),
    });

    await service.recordLifecycleUsage({
      kind: "prompt_sent",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      turnId: "turn-1",
    });
    await service.recordLifecycleUsage({
      kind: "turn_completed",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      turnId: "turn-1",
    });
    await service.recordQuotaRefresh({
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai",
      status: "ready",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      windows: [
        {
          id: "5h",
          label: "5h",
          percentRemaining: 52,
          resetAt: "2026-06-12T05:00:00.000Z",
        },
      ],
    });

    const summary = await service.getSummary("user-1", { range: "7d" });

    expect(summary.totals.promptCount).toBe(1);
    expect(summary.totals.turnCount).toBe(1);
    expect(summary.totals.quotaRefreshCount).toBe(1);
    expect(summary.totals.activeProjects).toBe(1);
    expect(summary.totals.activeChats).toBe(1);
    expect(summary.byProject[0]?.key).toBe("project-1");
    expect(
      summary.recent.find((record) => record.kind === "quota_refreshed")
        ?.quotaWindows?.[0]?.percentRemaining
    ).toBe(52);
  });

  test("keeps telemetry disabled until explicitly opted in", async () => {
    const service = new UsageStatsService({
      repository: new InMemoryUsageStatsRepo(),
      nowMs: () => 10,
    });

    expect((await service.getTelemetrySettings("user-1")).enabled).toBe(false);

    const settings = await service.updateTelemetry("user-1", {
      enabled: true,
    });

    expect(settings).toEqual({ enabled: true, updatedAt: 10 });
  });
});
