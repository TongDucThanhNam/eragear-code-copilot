import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type { Settings } from "@/shared/types/settings.types";
import type { SettingsRepositoryPort } from "../application/ports/settings-repository.port";

export class SettingsSqliteWorkerRepository implements SettingsRepositoryPort {
  get(): Promise<Settings> {
    return callSqliteWorker("settings", "get", []);
  }

  save(settings: Settings): Promise<Settings> {
    return callSqliteWorker("settings", "save", [settings]);
  }
}
