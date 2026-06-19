import { ENV } from "#runtime/config/environment";
import type {
  SessionEventOutboxPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type {
  AppConfigService,
  SettingsRepositoryPort,
  UiSettingsService,
} from "#runtime/modules/settings";
import { SettingsSqliteRepository } from "#runtime/modules/settings/di";
import type { AppUseCases } from "#runtime/modules/use-cases";
import type { AuthRuntime } from "#runtime/platform/auth/auth";
import { setRuntimeLogLevel } from "#runtime/platform/logging/runtime-log-level";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LogStorePort } from "#runtime/shared/ports/log-store.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { BackgroundRunnerState } from "#runtime/shared/types/background.types";
import { normalizeProjectRootsForSettings } from "#runtime/shared/utils/project-roots.util";
import { initializeAuthOwner } from "./init/auth-owner.init";
import { initializeCoreModule } from "./init/core-module.init";
import { initializeModuleEventSubscriptions } from "./init/module-event-subscriptions.init";
import { initializePersistenceOwner } from "./init/persistence-owner.init";
import {
  type AppRuntimeConfig,
  applyAppConfigToRuntimeConfig,
  resolveAppRuntimeConfig,
} from "./init/runtime-config.init";
import {
  type ResolveAuthContext as InitResolveAuthContext,
  initializeServiceModule,
} from "./init/service-module.init";
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
  uiSettings: UiSettingsService;
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

  const authOwner = initializeAuthOwner(runtimeConfig.authPolicy);
  const { authRuntime } = authOwner;
  const core = initializeCoreModule({
    sessionBufferLimit: runtimeConfig.sessionBufferLimit,
    sessionLockAcquireTimeoutMs: runtimeConfig.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      runtimeConfig.sessionEventBusPublishMaxQueuePerChat,
  });

  const persistenceOwner = await initializePersistenceOwner({
    normalizedRoots,
    sqliteWorkerEnabled: runtimeConfig.sqliteWorkerEnabled,
    logger: core.appLogger,
    settingsRepoOverride,
  });
  const { appConfigService, persistence, uiSettingsService } = persistenceOwner;
  applyAppConfigToRuntimeConfig(runtimeConfig, appConfigService.getConfig());
  const unsubscribeRuntimeConfigSync = appConfigService.subscribe(
    (nextConfig) => applyAppConfigToRuntimeConfig(runtimeConfig, nextConfig)
  );

  core.sessionAcpAdapter.setReasoningEnabledProvider(() =>
    uiSettingsService.isReasoningVisible()
  );

  const serviceModule = initializeServiceModule({
    core,
    persistence,
    appConfigService,
    uiSettingsService,
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
    uiSettings: uiSettingsService,
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

  const moduleEventSubscriptions = initializeModuleEventSubscriptions({
    eventBus: deps.eventBus,
    useCases: deps.useCases,
    sessionRuntime: deps.sessionRuntime,
    logger: deps.appLogger,
  });

  let disposed = false;
  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    unsubscribeRuntimeConfigSync();
    moduleEventSubscriptions.dispose();
    serviceModule.dispose();
    await persistenceOwner.dispose();
    authOwner.dispose();
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
