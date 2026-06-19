import {
  AppConfigService,
  type SettingsRepositoryPort,
  UiSettingsService,
} from "#runtime/modules/settings";
import { setRuntimeLogLevel } from "#runtime/platform/logging/runtime-log-level";
import { closeSqliteStorage } from "#runtime/platform/storage/sqlite-db";
import {
  initializeSqliteWorker,
  updateSqliteWorkerRuntimeConfig,
} from "#runtime/platform/storage/sqlite-worker-client";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import {
  initializePersistenceModule,
  initializeSettingsRepository,
  type PersistenceModule,
} from "./persistence-module.init";
import { createSqliteWorkerRuntimeConfigSync } from "./sqlite-worker-runtime-config-sync.init";

export interface PersistenceOwner {
  settingsRepo: SettingsRepositoryPort;
  appConfigService: AppConfigService;
  uiSettingsService: UiSettingsService;
  persistence: PersistenceModule;
  dispose(): Promise<void>;
}

export async function initializePersistenceOwner(params: {
  normalizedRoots: string[];
  sqliteWorkerEnabled: boolean;
  logger: LoggerPort;
  settingsRepoOverride?: SettingsRepositoryPort;
}): Promise<PersistenceOwner> {
  const { logger, normalizedRoots, settingsRepoOverride, sqliteWorkerEnabled } =
    params;

  if (sqliteWorkerEnabled) {
    await initializeSqliteWorker(normalizedRoots);
  }

  const settingsRepo =
    settingsRepoOverride ?? initializeSettingsRepository(sqliteWorkerEnabled);
  const appConfigService = await AppConfigService.create(settingsRepo);
  const uiSettingsService = await UiSettingsService.create(settingsRepo);
  setRuntimeLogLevel(appConfigService.getConfig().logLevel);

  const persistence = initializePersistenceModule({
    sqliteWorkerEnabled,
    appConfigService,
    settingsRepoOverride: settingsRepo,
  });
  const unsubscribeCallbacks: Array<() => void> = [];
  const sqliteWorkerRuntimeConfigSync =
    createSqliteWorkerRuntimeConfigSync(logger);

  if (sqliteWorkerEnabled) {
    await updateSqliteWorkerRuntimeConfig(appConfigService.getConfig());
    unsubscribeCallbacks.push(
      appConfigService.subscribe((nextConfig) => {
        setRuntimeLogLevel(nextConfig.logLevel);
        sqliteWorkerRuntimeConfigSync.enqueue(nextConfig);
      })
    );
  } else {
    unsubscribeCallbacks.push(
      appConfigService.subscribe((nextConfig) => {
        setRuntimeLogLevel(nextConfig.logLevel);
      })
    );
  }

  let disposed = false;

  return {
    settingsRepo,
    appConfigService,
    uiSettingsService,
    persistence,
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const unsubscribe of unsubscribeCallbacks.splice(0)) {
        unsubscribe();
      }
      await sqliteWorkerRuntimeConfigSync.flush();
      try {
        await closeSqliteStorage();
      } catch (error) {
        logger.warn("Failed to close sqlite storage during dispose", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
