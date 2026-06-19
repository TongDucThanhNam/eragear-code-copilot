import type {
  UsageStatsRecord,
  UsageTelemetrySettings,
} from "../contracts/usage-stats.contract";

export interface UsageTelemetrySettingsSnapshot {
  get(): UsageTelemetrySettings | null;
}

export interface MutableUsageTelemetrySettingsSnapshot
  extends UsageTelemetrySettingsSnapshot {
  set(settings: UsageTelemetrySettings): void;
}

export interface UsageStatsRepositoryPort {
  appendRecord(record: UsageStatsRecord): Promise<UsageStatsRecord>;
  listRecords(
    userId: string,
    input?: { sinceMs?: number; limit?: number }
  ): Promise<UsageStatsRecord[]>;
  readTelemetrySettings<T>(
    userId: string,
    reader: (snapshot: UsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutateTelemetrySettings<T>(
    userId: string,
    mutator: (snapshot: MutableUsageTelemetrySettingsSnapshot) => T | Promise<T>
  ): Promise<T>;
}
