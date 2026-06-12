import {
  CrashReportingFileRepository,
  CrashReportingService,
} from "@/modules/crash-reporting";
import type { CrashReportingUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

export function createCrashReportingUseCases(): CrashReportingUseCases {
  const repository = new CrashReportingFileRepository({
    filePath: () => getStorageFileSync("crash-reports.json"),
  });

  return {
    crashReporting: new CrashReportingService({ repository }),
  };
}
