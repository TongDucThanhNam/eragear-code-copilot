import { describe, expect, test } from "bun:test";
import type {
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "./contracts/usage-stats.contract";
import type { UsageStatsRepositoryPort } from "./ports/usage-stats-repository.port";
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

  getTelemetrySettings(): Promise<UsageTelemetrySettings | null> {
    return Promise.resolve(this.telemetry);
  }

  saveTelemetrySettings(
    _userId: string,
    settings: UsageTelemetrySettings
  ): Promise<UsageTelemetrySettings> {
    this.telemetry = settings;
    return Promise.resolve(settings);
  }
}

describe("UsageStatsService", () => {
  test("records lifecycle and quota events into usage summary", async () => {
    const repo = new InMemoryUsageStatsRepo();
    const service = new UsageStatsService({
      repository: repo,
      nowMs: () => Date.UTC(2026, 5, 12),
    });

    await service.recordLifecycleEvent({
      type: "local_ade_lifecycle",
      event: "after-agent-message-send",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      turnId: "turn-1",
    });
    await service.recordLifecycleEvent({
      type: "local_ade_lifecycle",
      event: "after-agent-turn-complete",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
    });
    await service.recordQuotaRefreshedEvent({
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai",
      status: "ready",
      fetchedAt: new Date(Date.UTC(2026, 5, 12)).toISOString(),
      windows: [],
      changed: true,
    });

    const summary = await service.getSummary("user-1", { range: "7d" });

    expect(summary.totals.promptCount).toBe(1);
    expect(summary.totals.turnCount).toBe(1);
    expect(summary.totals.quotaRefreshCount).toBe(1);
    expect(summary.totals.activeProjects).toBe(1);
    expect(summary.totals.activeChats).toBe(1);
    expect(summary.byProject[0]?.key).toBe("project-1");
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
