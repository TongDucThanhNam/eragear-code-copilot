import type { UsageStatsCliSummary } from "../application/contracts/usage-stats.contract";
import type { UsageStatsScannerInput } from "../application/ports/usage-stats-scanner.port";

export const USAGE_STATS_SCAN_WORKER_KIND = "usage_stats_scan" as const;

export interface UsageStatsScanWorkerRequest {
  kind: typeof USAGE_STATS_SCAN_WORKER_KIND;
  id: number;
  input: UsageStatsScannerInput;
}

export interface UsageStatsScanWorkerResponse {
  kind: typeof USAGE_STATS_SCAN_WORKER_KIND;
  id: number;
  result?: UsageStatsCliSummary;
  error?: string;
}
