import type {
  UsageStatsCliProviderId,
  UsageStatsCliSummary,
  UsageStatsRange,
} from "../contracts/usage-stats.contract";

export interface UsageStatsScannerInput {
  range: UsageStatsRange;
  startMs?: number;
  endMs: number;
  providers?: UsageStatsCliProviderId[];
}

export interface UsageStatsScannerPort {
  scan(input: UsageStatsScannerInput): Promise<UsageStatsCliSummary>;
}
