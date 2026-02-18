import type { AgentRepositoryPort } from "@/modules/agent";
import {
  AgentSqliteRepository,
  AgentSqliteWorkerRepository,
} from "@/modules/agent/di";
import type { SendMessagePolicy } from "@/modules/ai";
import { GetMeService } from "@/modules/auth";
import type { ProjectRepositoryPort } from "@/modules/project";
import {
  ProjectSqliteRepository,
  ProjectSqliteWorkerRepository,
} from "@/modules/project/di";
import type {
  AgentServiceFactory,
  AiServiceFactory,
  AuthServiceFactory,
  OpsServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
  ToolingServiceFactory,
} from "@/modules/service-factories";
import type {
  SessionAcpPort,
  SessionEventOutboxPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import {
  createSessionEventOutbox,
  createSessionRepository,
  createSessionRuntimeStore,
  SessionAcpAdapter,
} from "@/modules/session/di";
import {
  AppConfigService,
  type SettingsRepositoryPort,
} from "@/modules/settings";
import {
  SettingsSqliteRepository,
  SettingsSqliteWorkerRepository,
} from "@/modules/settings/di";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import { EventBus } from "@/shared/utils/event-bus";
import { normalizeProjectRootsForSettings } from "@/shared/utils/project-roots.util";
import { ENV } from "../config/environment";
import { AuthUserReadAdapter } from "../platform/auth/adapters/auth-user-read.adapter";
import {
  type AuthRuntime,
  type AuthRuntimePolicy,
  createAuthRuntime,
} from "../platform/auth/auth";
import {
  type AuthContext,
  createAuthContextResolver,
} from "../platform/auth/guards";
import { getResponseCache } from "../platform/caching/response-cache";
import type { CacheStats } from "../platform/caching/types";
import { GitAdapter } from "../platform/git";
import { getLogStore } from "../platform/logging/log-store";
import { createAppLogger } from "../platform/logging/logger-adapter";
import { setRuntimeLogLevel } from "../platform/logging/runtime-log-level";
import { AgentRuntimeAdapter } from "../platform/process";
import { closeSqliteStorage } from "../platform/storage/sqlite-db";
import {
  initializeSqliteWorker,
  updateSqliteWorkerRuntimeConfig,
} from "../platform/storage/sqlite-worker-client";
import { systemClock } from "../platform/time/system-clock";
import {
  createServerLifecycle,
  type ServerLifecycle,
  type ServerLifecyclePolicy,
} from "./lifecycle";
import type { ServerRuntimePolicy } from "./server";
import { createAgentServices } from "./service-registry/agent-services";
import { createAiServices } from "./service-registry/ai-services";
import type { ServiceRegistryDependencies } from "./service-registry/dependencies";
import { createOpsServices } from "./service-registry/ops-services";
import { createProjectServices } from "./service-registry/project-services";
import { createSessionServices } from "./service-registry/session-services";
import { createSettingsServices } from "./service-registry/settings-services";
import { createToolingServices } from "./service-registry/tooling-services";

interface PersistenceDependencies {
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
}

export type ResolveAuthContext = (req?: {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}) => Promise<AuthContext | null>;

export interface AppDependencies {
  eventBus: EventBusPort;
  sessionEventOutbox: SessionEventOutboxPort;
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  appConfig: AppConfigService;
  sessionServices: SessionServiceFactory;
  aiServices: AiServiceFactory;
  projectServices: ProjectServiceFactory;
  agentServices: AgentServiceFactory;
  settingsServices: SettingsServiceFactory;
  toolingServices: ToolingServiceFactory;
  authServices: AuthServiceFactory;
  opsServices: OpsServiceFactory;
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

interface AppRuntimeConfig {
  sqliteWorkerEnabled: boolean;
  allowedAgentCommandPolicies: typeof ENV.allowedAgentCommandPolicies;
  allowedEnvKeys: string[];
  agentTimeoutMs: number | undefined;
  sessionBufferLimit: number;
  sessionLockAcquireTimeoutMs: number;
  sessionEventBusPublishTimeoutMs: number;
  sessionEventBusPublishMaxQueuePerChat: number;
  sendMessagePolicy: SendMessagePolicy;
  authPolicy: AuthRuntimePolicy;
  lifecyclePolicy: ServerLifecyclePolicy;
  serverPolicy: ServerRuntimePolicy;
}

interface SqliteWorkerRuntimeConfigSync {
  enqueue(config: ReturnType<AppConfigService["getConfig"]>): void;
  flush(): Promise<void>;
}

function resolveAppRuntimeConfig(): AppRuntimeConfig {
  return {
    sqliteWorkerEnabled: ENV.sqliteWorkerEnabled,
    allowedAgentCommandPolicies: ENV.allowedAgentCommandPolicies,
    allowedEnvKeys: ENV.allowedEnvKeys,
    agentTimeoutMs: ENV.agentTimeoutMs,
    sessionBufferLimit: ENV.sessionBufferLimit,
    sessionLockAcquireTimeoutMs: ENV.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishTimeoutMs: ENV.sessionEventBusPublishTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      ENV.sessionEventBusPublishMaxQueuePerChat,
    sendMessagePolicy: {
      messageContentMaxBytes: ENV.messageContentMaxBytes,
      messagePartsMaxBytes: ENV.messagePartsMaxBytes,
      acpRetryMaxAttempts: ENV.acpRequestMaxAttempts,
      acpRetryBaseDelayMs: ENV.acpRequestRetryBaseDelayMs,
    },
    authPolicy: {
      authBaseUrl: ENV.authBaseUrl,
      authTrustedOrigins: ENV.authTrustedOrigins,
      authApiKeyPrefix: ENV.authApiKeyPrefix,
      authApiKeyRateLimitEnabled: ENV.authApiKeyRateLimitEnabled,
      authApiKeyRateLimitTimeWindowMs: ENV.authApiKeyRateLimitTimeWindowMs,
      authApiKeyRateLimitMaxRequests: ENV.authApiKeyRateLimitMaxRequests,
    },
    lifecyclePolicy: {
      sqliteRetentionHotDays: ENV.sqliteRetentionHotDays,
      backgroundTaskTimeoutMs: ENV.backgroundTaskTimeoutMs,
      sqliteRetentionCompactionBatchSize:
        ENV.sqliteRetentionCompactionBatchSize,
      authBootstrapApiKey: ENV.authBootstrapApiKey,
      authApiKeyPrefix: ENV.authApiKeyPrefix,
    },
    serverPolicy: {
      wsHost: ENV.wsHost,
      wsPort: ENV.wsPort,
      wsMaxPayloadBytes: ENV.wsMaxPayloadBytes,
      httpMaxBodyBytes: ENV.httpMaxBodyBytes,
      corsStrictOrigin: ENV.corsStrictOrigin,
      authAllowSignup: ENV.authAllowSignup,
      authRequireCloudflareAccess: ENV.authRequireCloudflareAccess,
      authCloudflareAccessClientId: ENV.authCloudflareAccessClientId,
      authCloudflareAccessClientSecret: ENV.authCloudflareAccessClientSecret,
      authCloudflareAccessJwtPublicKeyPem:
        ENV.authCloudflareAccessJwtPublicKeyPem,
      authCloudflareAccessJwtAudience: ENV.authCloudflareAccessJwtAudience,
      authCloudflareAccessJwtIssuer: ENV.authCloudflareAccessJwtIssuer,
      isDev: ENV.isDev,
      defaultAdminUsername: ENV.authAdminUsername ?? "admin",
      runtimeNodeRole: ENV.runtimeNodeRole,
      runtimeWriterUrl: ENV.runtimeWriterUrl,
      runtimeInternalToken: ENV.runtimeInternalToken,
    },
  };
}

function createPersistenceDependencies(
  settingsRepo: SettingsRepositoryPort,
  appConfigService: AppConfigService,
  sqliteWorkerEnabled: boolean
): PersistenceDependencies {
  return {
    sessionRepo: createSessionRepository({
      useWorker: sqliteWorkerEnabled,
      policyProvider: () => {
        const appConfig = appConfigService.getConfig();
        return {
          sessionListPageMaxLimit: appConfig.sessionListPageMaxLimit,
          sessionMessagesPageMaxLimit: appConfig.sessionMessagesPageMaxLimit,
        };
      },
    }),
    projectRepo: sqliteWorkerEnabled
      ? new ProjectSqliteWorkerRepository()
      : new ProjectSqliteRepository(),
    agentRepo: sqliteWorkerEnabled
      ? new AgentSqliteWorkerRepository()
      : new AgentSqliteRepository(),
    settingsRepo,
  };
}

function createSettingsRepository(
  sqliteWorkerEnabled: boolean
): SettingsRepositoryPort {
  if (sqliteWorkerEnabled) {
    return new SettingsSqliteWorkerRepository();
  }
  return new SettingsSqliteRepository();
}

function createCoreDependencies(policy: {
  sessionBufferLimit: number;
  sessionLockAcquireTimeoutMs: number;
  sessionEventBusPublishTimeoutMs: number;
  sessionEventBusPublishMaxQueuePerChat: number;
}): {
  eventBus: EventBusPort;
  sessionEventOutbox: SessionEventOutboxPort;
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  clock: ClockPort;
  sessionAcpAdapter: SessionAcpPort;
} {
  const appLogger = createAppLogger("Server");
  const eventBus = new EventBus(appLogger);
  const sessionEventOutbox = createSessionEventOutbox();
  return {
    eventBus,
    sessionEventOutbox,
    sessionRuntime: createSessionRuntimeStore({
      outbox: sessionEventOutbox,
      policy: {
        sessionBufferLimit: policy.sessionBufferLimit,
        lockAcquireTimeoutMs: policy.sessionLockAcquireTimeoutMs,
        eventBusPublishTimeoutMs: policy.sessionEventBusPublishTimeoutMs,
        eventBusPublishMaxQueuePerChat:
          policy.sessionEventBusPublishMaxQueuePerChat,
      },
    }),
    logStore: getLogStore(),
    appLogger,
    clock: systemClock,
    sessionAcpAdapter: new SessionAcpAdapter(),
  };
}

function createSqliteWorkerRuntimeConfigSync(
  logger: LoggerPort
): SqliteWorkerRuntimeConfigSync {
  let tail = Promise.resolve();

  const enqueue = (config: ReturnType<AppConfigService["getConfig"]>) => {
    tail = tail
      .catch(() => undefined)
      .then(async () => {
        await updateSqliteWorkerRuntimeConfig(config);
      })
      .catch((error) => {
        logger.error("Failed to sync runtime config to sqlite worker", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return {
    enqueue,
    async flush() {
      await tail.catch(() => undefined);
    },
  };
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
  const runtime = createAuthRuntime(runtimeConfig.authPolicy);
  const core = createCoreDependencies({
    sessionBufferLimit: runtimeConfig.sessionBufferLimit,
    sessionLockAcquireTimeoutMs: runtimeConfig.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishTimeoutMs:
      runtimeConfig.sessionEventBusPublishTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      runtimeConfig.sessionEventBusPublishMaxQueuePerChat,
  });
  if (runtimeConfig.sqliteWorkerEnabled) {
    await initializeSqliteWorker(normalizedRoots);
  }
  const settingsRepo =
    settingsRepoOverride ??
    createSettingsRepository(runtimeConfig.sqliteWorkerEnabled);
  const appConfigService = await AppConfigService.create(settingsRepo);
  setRuntimeLogLevel(appConfigService.getConfig().logLevel);
  const persistence = createPersistenceDependencies(
    settingsRepo,
    appConfigService,
    runtimeConfig.sqliteWorkerEnabled
  );

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

  const gitAdapter = new GitAdapter();
  const agentRuntimeAdapter = new AgentRuntimeAdapter({
    allowedAgentCommandPolicies: runtimeConfig.allowedAgentCommandPolicies,
    allowedEnvKeys: runtimeConfig.allowedEnvKeys,
    agentTimeoutMs: runtimeConfig.agentTimeoutMs,
  });
  const resolveAuthContext: ResolveAuthContext = createAuthContextResolver(
    runtime.auth
  );
  let backgroundRunnerStateProvider: (() => BackgroundRunnerState) | undefined;
  const setBackgroundRunnerStateProvider = (
    provider: () => BackgroundRunnerState
  ) => {
    backgroundRunnerStateProvider = provider;
  };
  const getBackgroundRunnerState = (): BackgroundRunnerState | null => {
    if (!backgroundRunnerStateProvider) {
      return null;
    }
    return backgroundRunnerStateProvider();
  };
  const getCacheStats = (): CacheStats => getResponseCache().getStats();
  const serviceRegistryDependencies: ServiceRegistryDependencies = {
    ...core,
    ...persistence,
    appConfigService,
    gitAdapter,
    agentRuntimeAdapter,
    sendMessagePolicy: runtimeConfig.sendMessagePolicy,
    getCacheStats,
    getBackgroundRunnerState,
  };
  const sessionServices = createSessionServices(serviceRegistryDependencies);
  const aiServices = createAiServices(serviceRegistryDependencies);
  const projectServices = createProjectServices(serviceRegistryDependencies);
  const agentServices = createAgentServices(serviceRegistryDependencies);
  const settingsServices = createSettingsServices(serviceRegistryDependencies);
  const toolingServices = createToolingServices(serviceRegistryDependencies);
  const opsServices = createOpsServices(serviceRegistryDependencies);
  const authUserRead = new AuthUserReadAdapter(runtime.authDb);
  const authServices: AuthServiceFactory = {
    getMe: () => new GetMeService(authUserRead),
  };
  const lifecycle = createServerLifecycle({
    authRuntime: runtime,
    agentRuntime: agentRuntimeAdapter,
    sessionRuntime: core.sessionRuntime,
    sessionRepo: persistence.sessionRepo,
    sessionEventOutbox: core.sessionEventOutbox,
    eventBus: core.eventBus,
    sessionServices,
    appConfig: appConfigService,
    policy: runtimeConfig.lifecyclePolicy,
    setBackgroundRunnerStateProvider,
  });
  const deps: AppDependencies = {
    eventBus: core.eventBus,
    sessionEventOutbox: core.sessionEventOutbox,
    sessionRuntime: core.sessionRuntime,
    logStore: core.logStore,
    appLogger: core.appLogger,
    appConfig: appConfigService,
    sessionServices,
    aiServices,
    projectServices,
    agentServices,
    settingsServices,
    toolingServices,
    authServices,
    opsServices,
    sessionRepo: persistence.sessionRepo,
    auth: runtime.auth,
    authRuntime: runtime,
    lifecycle,
    resolveAuthContext,
    setBackgroundRunnerStateProvider,
    getBackgroundRunnerState,
  };

  const unsubscribeProjectDeleting = deps.eventBus.subscribe(async (event) => {
    if (event.type !== "project_deleting") {
      return;
    }
    const service = deps.sessionServices.cleanupProjectSessions();
    await service.execute({
      userId: event.userId,
      projectId: event.projectId,
      projectPath: event.projectPath,
    });
  });
  unsubscribeCallbacks.push(unsubscribeProjectDeleting);

  let disposed = false;
  const dispose = async () => {
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
      core.appLogger.warn("Failed to close sqlite storage during dispose", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      runtime.authDb.close();
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
