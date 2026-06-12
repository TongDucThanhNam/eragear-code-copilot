import { ENV } from "@/config/environment";
import { initializeFileWatcherEvents } from "@/modules/file-watcher/init/file-watcher-events.init";
import { initializeGitEvents } from "@/modules/git/init/git-events.init";
import { initializeProjectEvents } from "@/modules/project/init/project-events.init";
import type {
  SessionEventOutboxPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { initializeSubagentEvents } from "@/modules/session/init/subagent-events.init";
import {
  AppConfigService,
  type SettingsRepositoryPort,
} from "@/modules/settings";
import { SettingsSqliteRepository } from "@/modules/settings/di";
import { initializeUsageStatsEvents } from "@/modules/usage-stats/init/usage-stats-events.init";
import type { AppUseCases } from "@/modules/use-cases";
import type { AuthRuntime } from "@/platform/auth/auth";
import { setRuntimeLogLevel } from "@/platform/logging/runtime-log-level";
import { closeSqliteStorage } from "@/platform/storage/sqlite-db";
import {
  initializeSqliteWorker,
  updateSqliteWorkerRuntimeConfig,
} from "@/platform/storage/sqlite-worker-client";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import { normalizeProjectRootsForSettings } from "@/shared/utils/project-roots.util";
import { initializeAuthModule } from "./init/auth-module.init";
import { initializeCoreModule } from "./init/core-module.init";
import {
  initializePersistenceModule,
  initializeSettingsRepository,
} from "./init/persistence-module.init";
import {
  type AppRuntimeConfig,
  resolveAppRuntimeConfig,
} from "./init/runtime-config.init";
import {
  type ResolveAuthContext as InitResolveAuthContext,
  initializeServiceModule,
} from "./init/service-module.init";
import { createSqliteWorkerRuntimeConfigSync } from "./init/sqlite-worker-runtime-config-sync.init";
import type { ServerLifecycle } from "./lifecycle";
import type { ServerRuntimePolicy } from "./server-runtime-policy";

export type ResolveAuthContext = InitResolveAuthContext;

export interface AppDependencies {
  eventBus: EventBusPort;
  sessionEventOutbox: SessionEventOutboxPort;
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  appConfig: AppConfigService;
  useCases: AppUseCases;
  sessionRepo: SessionRepositoryPort;
  auth: AuthRuntime["auth"];
  authRuntime: AuthRuntime;
  lifecycle: ServerLifecycle;
  resolveAuthContext: ResolveAuthContext;
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}

export interface AppComposition {
  deps: AppDependencies;
  allowedRoots: string[];
  runtimePolicy: ServerRuntimePolicy;
  dispose(): Promise<void>;
}

function normalizeAllowedRoots(roots: string[]): string[] {
  return normalizeProjectRootsForSettings(roots);
}

async function createAppCompositionWithRuntimeConfig(
  allowedRoots: string[],
  runtimeConfig: AppRuntimeConfig,
  settingsRepoOverride?: SettingsRepositoryPort
): Promise<AppComposition> {
  const normalizedRoots = normalizeAllowedRoots(allowedRoots);
  setRuntimeLogLevel(ENV.logLevel);

  const { authRuntime } = initializeAuthModule(runtimeConfig.authPolicy);
  const core = initializeCoreModule({
    sessionBufferLimit: runtimeConfig.sessionBufferLimit,
    sessionLockAcquireTimeoutMs: runtimeConfig.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      runtimeConfig.sessionEventBusPublishMaxQueuePerChat,
  });

  if (runtimeConfig.sqliteWorkerEnabled) {
    await initializeSqliteWorker(normalizedRoots);
  }

  const settingsRepo =
    settingsRepoOverride ??
    initializeSettingsRepository(runtimeConfig.sqliteWorkerEnabled);
  const appConfigService = await AppConfigService.create(settingsRepo);
  setRuntimeLogLevel(appConfigService.getConfig().logLevel);

  const persistence = initializePersistenceModule({
    sqliteWorkerEnabled: runtimeConfig.sqliteWorkerEnabled,
    appConfigService,
    settingsRepoOverride: settingsRepo,
  });

  const unsubscribeCallbacks: Array<() => void> = [];
  const sqliteWorkerRuntimeConfigSync = createSqliteWorkerRuntimeConfigSync(
    core.appLogger
  );

  if (runtimeConfig.sqliteWorkerEnabled) {
    await updateSqliteWorkerRuntimeConfig(appConfigService.getConfig());
    const unsubscribe = appConfigService.subscribe((nextConfig) => {
      setRuntimeLogLevel(nextConfig.logLevel);
      sqliteWorkerRuntimeConfigSync.enqueue(nextConfig);
    });
    unsubscribeCallbacks.push(unsubscribe);
  } else {
    const unsubscribe = appConfigService.subscribe((nextConfig) => {
      setRuntimeLogLevel(nextConfig.logLevel);
    });
    unsubscribeCallbacks.push(unsubscribe);
  }

  const serviceModule = initializeServiceModule({
    core,
    persistence,
    appConfigService,
    runtimeConfig,
    authRuntime,
  });

  const deps: AppDependencies = {
    eventBus: core.eventBus,
    sessionEventOutbox: core.sessionEventOutbox,
    sessionRuntime: core.sessionRuntime,
    logStore: core.logStore,
    appLogger: core.appLogger,
    appConfig: appConfigService,
    useCases: serviceModule.useCases,
    sessionRepo: persistence.sessionRepo,
    auth: authRuntime.auth,
    authRuntime,
    lifecycle: serviceModule.lifecycle,
    resolveAuthContext: serviceModule.resolveAuthContext,
    setBackgroundRunnerStateProvider:
      serviceModule.setBackgroundRunnerStateProvider,
    getBackgroundRunnerState: serviceModule.getBackgroundRunnerState,
  };

  unsubscribeCallbacks.push(
    initializeProjectEvents({
      eventBus: deps.eventBus,
      sessionUseCases: deps.useCases.session,
    })
  );
  unsubscribeCallbacks.push(
    initializeGitEvents({
      eventBus: deps.eventBus,
      gitUseCases: deps.useCases.git,
      logger: deps.appLogger,
    })
  );
  unsubscribeCallbacks.push(
    initializeSubagentEvents({
      eventBus: deps.eventBus,
      sessionUseCases: deps.useCases.session,
      logger: deps.appLogger,
    })
  );
  unsubscribeCallbacks.push(
    initializeFileWatcherEvents({
      eventBus: deps.eventBus,
      fileWatcherUseCases: deps.useCases.fileWatcher,
      sessionRuntime: deps.sessionRuntime,
      logger: deps.appLogger,
    })
  );
  unsubscribeCallbacks.push(
    initializeUsageStatsEvents({
      eventBus: deps.eventBus,
      usageStatsUseCases: deps.useCases.usageStats,
      logger: deps.appLogger,
    })
  );

  let disposed = false;
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const unsubscribe of unsubscribeCallbacks.splice(0)) {
      unsubscribe();
    }
    deps.useCases.fileWatcher.fileWatcher.dispose();
    await sqliteWorkerRuntimeConfigSync.flush();
    try {
      await closeSqliteStorage();
    } catch (error) {
      core.appLogger.warn("Failed to close sqlite storage during dispose", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      authRuntime.authDb.close();
    } catch (error) {
      core.appLogger.warn("Failed to close auth database during dispose", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await core.logStore.flush();
  };

  return {
    deps,
    allowedRoots: normalizedRoots,
    runtimePolicy: runtimeConfig.serverPolicy,
    dispose,
  };
}

export async function createAppComposition(
  allowedRoots: string[]
): Promise<AppComposition> {
  const runtimeConfig = resolveAppRuntimeConfig();
  return await createAppCompositionWithRuntimeConfig(
    allowedRoots,
    runtimeConfig
  );
}

export async function createAppCompositionFromSettings(): Promise<AppComposition> {
  const runtimeConfig = resolveAppRuntimeConfig();
  const bootstrapSettingsRepo = new SettingsSqliteRepository();
  const settings = await bootstrapSettingsRepo.get();
  return await createAppCompositionWithRuntimeConfig(
    settings.projectRoots,
    runtimeConfig
  );
}
