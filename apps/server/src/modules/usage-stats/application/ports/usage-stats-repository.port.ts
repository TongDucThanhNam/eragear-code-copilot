import type {
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "../contracts/usage-stats.contract";

export interface UsageStatsRepositoryPort {
  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord>;
  listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]>;
  getTelemetrySettings(userId: string): Promise<UsageTelemetrySettings | null>;
  saveTelemetrySettings(
    userId: string,
    settings: UsageTelemetrySettings
  ): Promise<UsageTelemetrySettings>;
}
