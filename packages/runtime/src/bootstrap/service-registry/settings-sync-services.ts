import type { UpdateSettingsService } from "#runtime/modules/settings";
import {
  SettingsSyncFileRepository,
  SettingsSyncService,
} from "#runtime/modules/settings-sync";
import type {
  SettingsSyncUseCases,
  UseCasePort,
} from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type SettingsSyncServiceDependencies = ServiceRegistrySlice<"settingsRepo">;

export function createSettingsSyncUseCases(
  deps: SettingsSyncServiceDependencies,
  settingsUpdater: UseCasePort<UpdateSettingsService>
): SettingsSyncUseCases {
  const repository = new SettingsSyncFileRepository({
    stateFilePath: () => getStorageFileSync("settings-sync-state.json"),
    remoteFilePath: () => getStorageFileSync("settings-sync-cloud.json"),
  });

  return {
    settingsSync: new SettingsSyncService({
      settingsRepo: deps.settingsRepo,
      settingsUpdater,
      stateRepo: repository,
      cloud: repository,
    }),
  };
}
