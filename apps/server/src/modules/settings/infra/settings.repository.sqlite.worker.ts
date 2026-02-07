import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type { Settings } from "@/shared/types/settings.types";
import type { SettingsRepositoryPort } from "../application/ports/settings-repository.port";

export class SettingsSqliteWorkerRepository implements SettingsRepositoryPort {
  get(): Promise<Settings> {
    return callSqliteWorker("settings", "get", []);
  }

  update(patch: Partial<Settings>): Promise<Settings> {
    return callSqliteWorker("settings", "update", [patch]);
  }
}
