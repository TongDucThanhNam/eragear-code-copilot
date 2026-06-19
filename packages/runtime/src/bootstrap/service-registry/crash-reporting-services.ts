import { CrashReportingService } from "#runtime/modules/crash-reporting";
import { CrashReportingFileRepository } from "#runtime/modules/crash-reporting/di";
import type { CrashReportingUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createCrashReportingUseCases(): CrashReportingUseCases {
  const repository = new CrashReportingFileRepository({
    filePath: () => getStorageFileSync("crash-reports.json"),
  });

  return {
    crashReporting: new CrashReportingService({ repository }),
  };
}
