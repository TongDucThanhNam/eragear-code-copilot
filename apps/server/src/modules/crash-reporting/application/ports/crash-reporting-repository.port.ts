import type {
  CrashReport,
  CrashReportingConfig,
} from "../contracts/crash-reporting.contract";

export interface CrashReportingRepositoryPort {
  getConfig(): Promise<CrashReportingConfig | null>;
  saveConfig(config: CrashReportingConfig): Promise<CrashReportingConfig>;
  listReports(userId: string): Promise<CrashReport[]>;
  saveReport(report: CrashReport, archiveLimit: number): Promise<CrashReport>;
}
