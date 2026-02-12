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
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import {
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
import { ENV } from "../config/environment";
import { AuthUserReadAdapter } from "../platform/auth/adapters/auth-user-read.adapter";
import {
  type AuthRuntime,
  type AuthRuntimePolicy,
  createAuthRuntime,
} from "../platform/auth/auth";
import { createAuthContextResolver } from "../platform/auth/guards";
import { GitAdapter } from "../platform/git";
import { getLogStore } from "../platform/logging/log-store";
import { createAppLogger } from "../platform/logging/logger-adapter";
import { setRuntimeLogLevel } from "../platform/logging/runtime-log-level";
import { AgentRuntimeAdapter } from "../platform/process";
import {
  initializeSqliteWorker,
  updateSqliteWorkerRuntimeConfig,
} from "../platform/storage/sqlite-worker-client";
import { systemClock } from "../platform/time/system-clock";
import { Container, type ContainerDependencies } from "./container";
import {
  createServerLifecycle,
  type ServerLifecycle,
  type ServerLifecyclePolicy,
} from "./lifecycle";
import type { ServerRuntimePolicy } from "./server";

interface PersistenceDependencies {
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
}

export interface AppDependencies {
  eventBus: EventBusPort;
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
  resolveAuthContext: ContainerDependencies["resolveAuthContext"];
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}

export interface AppComposition {
  deps: AppDependencies;
  allowedRoots: string[];
  runtimePolicy: ServerRuntimePolicy;
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
      corsStrictOrigin: ENV.corsStrictOrigin,
      authAllowSignup: ENV.authAllowSignup,
      isDev: ENV.isDev,
      defaultAdminUsername: ENV.authAdminUsername ?? "admin",
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
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  clock: ClockPort;
  sessionAcpAdapter: SessionAcpPort;
} {
  const appLogger = createAppLogger("Debug");
  const eventBus = new EventBus(appLogger);
  return {
    eventBus,
    sessionRuntime: createSessionRuntimeStore({
      eventBus,
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

function normalizeAllowedRoots(roots: string[]): string[] {
  const normalized = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  if (normalized.length === 0) {
    return [process.cwd()];
  }
  return [...new Set(normalized)];
}

async function createAppCompositionWithRuntimeConfig(
  allowedRoots: string[],
  runtimeConfig: AppRuntimeConfig,
  settingsRepoOverride?: SettingsRepositoryPort
): Promise<AppComposition> {
  const normalizedRoots = normalizeAllowedRoots(allowedRoots);
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
    initializeSqliteWorker(normalizedRoots);
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

  if (runtimeConfig.sqliteWorkerEnabled) {
    await updateSqliteWorkerRuntimeConfig(appConfigService.getConfig());
    appConfigService.subscribe((nextConfig) => {
      setRuntimeLogLevel(nextConfig.logLevel);
      updateSqliteWorkerRuntimeConfig(nextConfig).catch((error) => {
        core.appLogger.error("Failed to sync runtime config to sqlite worker", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  } else {
    appConfigService.subscribe((nextConfig) => {
      setRuntimeLogLevel(nextConfig.logLevel);
    });
  }

  const dependencies: ContainerDependencies = {
    ...core,
    ...persistence,
    appConfigService,
    gitAdapter: new GitAdapter(),
    agentRuntimeAdapter: new AgentRuntimeAdapter({
      allowedAgentCommandPolicies: runtimeConfig.allowedAgentCommandPolicies,
      allowedEnvKeys: runtimeConfig.allowedEnvKeys,
      agentTimeoutMs: runtimeConfig.agentTimeoutMs,
    }),
    resolveAuthContext: createAuthContextResolver(runtime.auth),
    sendMessagePolicy: runtimeConfig.sendMessagePolicy,
  };
  const container = new Container(dependencies);
  const sessionServices = container.getSessionServices();
  const authUserRead = new AuthUserReadAdapter(runtime.authDb);
  const authServices: AuthServiceFactory = {
    getMe: () => new GetMeService(authUserRead),
  };
  const lifecycle = createServerLifecycle({
    authRuntime: runtime,
    agentRuntime: container.getAgentRuntime(),
    sessionRuntime: container.getSessionRuntime(),
    sessionRepo: container.getSessions(),
    sessionServices,
    appConfig: container.getAppConfigService(),
    policy: runtimeConfig.lifecyclePolicy,
    setBackgroundRunnerStateProvider: (provider) =>
      container.setBackgroundRunnerStateProvider(provider),
  });
  const deps: AppDependencies = {
    eventBus: container.getEventBus(),
    sessionRuntime: container.getSessionRuntime(),
    logStore: container.getLogStore(),
    appLogger: container.getAppLogger(),
    appConfig: container.getAppConfigService(),
    sessionServices,
    aiServices: container.getAiServices(),
    projectServices: container.getProjectServices(),
    agentServices: container.getAgentServices(),
    settingsServices: container.getSettingsServices(),
    toolingServices: container.getToolingServices(),
    authServices,
    opsServices: container.getOpsServices(),
    sessionRepo: container.getSessions(),
    auth: runtime.auth,
    authRuntime: runtime,
    lifecycle,
    resolveAuthContext: (req) => container.getAuthContext(req),
    setBackgroundRunnerStateProvider: (provider) =>
      container.setBackgroundRunnerStateProvider(provider),
    getBackgroundRunnerState: () => container.getBackgroundRunnerState(),
  };

  deps.eventBus.subscribe(async (event) => {
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

  return {
    deps,
    allowedRoots: normalizedRoots,
    runtimePolicy: runtimeConfig.serverPolicy,
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
  const settingsRepo = createSettingsRepository(
    runtimeConfig.sqliteWorkerEnabled
  );
  const settings = await settingsRepo.get();
  return await createAppCompositionWithRuntimeConfig(
    settings.projectRoots,
    runtimeConfig,
    settingsRepo
  );
}
