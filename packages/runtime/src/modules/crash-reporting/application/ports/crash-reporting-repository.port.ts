import type {
  CrashReport,
  CrashReportingConfig,
} from "../contracts/crash-reporting.contract";

export interface CrashReportingStoreSnapshot {
  config: CrashReportingConfig | null;
  reports: readonly CrashReport[];
}

export interface MutableCrashReportingStoreSnapshot {
  config: CrashReportingConfig | null;
  reports: CrashReport[];
}

export interface CrashReportingRepositoryPort {
  read<T>(
    reader: (snapshot: CrashReportingStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableCrashReportingStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}
