import type { AgentRepositoryPort } from "@/modules/agent";
import {
  AgentSqliteRepository,
  AgentSqliteWorkerRepository,
} from "@/modules/agent/di";
import type { SendMessagePolicy } from "@/modules/ai";
import type { ProjectRepositoryPort } from "@/modules/project";
import {
  ProjectSqliteRepository,
  ProjectSqliteWorkerRepository,
} from "@/modules/project/di";
import type {
  AgentServiceFactory,
  AiServiceFactory,
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
  SessionAcpAdapter,
  SessionRuntimeStore,
  SessionSqliteRepository,
  SessionSqliteWorkerRepository,
} from "@/modules/session/di";
import type { SettingsRepositoryPort } from "@/modules/settings";
import {
  SettingsSqliteRepository,
  SettingsSqliteWorkerRepository,
} from "@/modules/settings/di";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import { EventBus } from "@/shared/utils/event-bus";
import { ENV } from "../config/environment";
import { auth, authDb } from "../platform/auth/auth";
import { getAuthContext } from "../platform/auth/guards";
import { GitAdapter } from "../platform/git";
import { getLogStore } from "../platform/logging/log-store";
import { createAppLogger } from "../platform/logging/logger-adapter";
import { AgentRuntimeAdapter } from "../platform/process";
import { systemClock } from "../platform/time/system-clock";
import { initializeSqliteWorker } from "../platform/storage/sqlite-worker-client";
import { Container, type ContainerDependencies } from "./container";

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
  sessionServices: SessionServiceFactory;
  aiServices: AiServiceFactory;
  projectServices: ProjectServiceFactory;
  agentServices: AgentServiceFactory;
  settingsServices: SettingsServiceFactory;
  toolingServices: ToolingServiceFactory;
  opsServices: OpsServiceFactory;
  sessionRepo: SessionRepositoryPort;
  auth: typeof auth;
  authDb: typeof authDb;
  resolveAuthContext: ContainerDependencies["resolveAuthContext"];
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}

export interface AppComposition {
  deps: AppDependencies;
  allowedRoots: string[];
}

function createPersistenceDependencies(
  allowedRoots: string[]
): PersistenceDependencies {
  if (ENV.sqliteWorkerEnabled) {
    initializeSqliteWorker(allowedRoots);
    return {
      sessionRepo: new SessionSqliteWorkerRepository(),
      projectRepo: new ProjectSqliteWorkerRepository(),
      agentRepo: new AgentSqliteWorkerRepository(),
      settingsRepo: new SettingsSqliteWorkerRepository(),
    };
  }

  return {
    sessionRepo: new SessionSqliteRepository({
      policy: {
        sessionListPageMaxLimit: ENV.sessionListPageMaxLimit,
        sessionMessagesPageMaxLimit: ENV.sessionMessagesPageMaxLimit,
      },
    }),
    projectRepo: new ProjectSqliteRepository(),
    agentRepo: new AgentSqliteRepository(),
    settingsRepo: new SettingsSqliteRepository(),
  };
}

function createCoreDependencies(): {
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
    sessionRuntime: new SessionRuntimeStore(eventBus, {
      sessionBufferLimit: ENV.sessionBufferLimit,
    }),
    logStore: getLogStore(),
    appLogger,
    clock: systemClock,
    sessionAcpAdapter: new SessionAcpAdapter(),
  };
}

function createSendMessagePolicy(): SendMessagePolicy {
  return {
    messageContentMaxBytes: ENV.messageContentMaxBytes,
    messagePartsMaxBytes: ENV.messagePartsMaxBytes,
    acpRetryMaxAttempts: ENV.acpRequestMaxAttempts,
    acpRetryBaseDelayMs: ENV.acpRequestRetryBaseDelayMs,
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

export function createAppComposition(allowedRoots: string[]): AppComposition {
  const normalizedRoots = normalizeAllowedRoots(allowedRoots);
  const core = createCoreDependencies();
  const persistence = createPersistenceDependencies(normalizedRoots);

  const dependencies: ContainerDependencies = {
    ...core,
    ...persistence,
    gitAdapter: new GitAdapter(),
    agentRuntimeAdapter: new AgentRuntimeAdapter(),
    authService: auth,
    authDb,
    resolveAuthContext: getAuthContext,
    sendMessagePolicy: createSendMessagePolicy(),
  };
  const container = new Container(dependencies);
  const sessionServices = container.getSessionServices();
  const deps: AppDependencies = {
    eventBus: container.getEventBus(),
    sessionRuntime: container.getSessionRuntime(),
    logStore: container.getLogStore(),
    appLogger: container.getAppLogger(),
    sessionServices,
    aiServices: container.getAiServices(),
    projectServices: container.getProjectServices(),
    agentServices: container.getAgentServices(),
    settingsServices: container.getSettingsServices(),
    toolingServices: container.getToolingServices(),
    opsServices: container.getOpsServices(),
    sessionRepo: container.getSessions(),
    auth: container.getAuth() as typeof auth,
    authDb: container.getAuthDb() as typeof authDb,
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
  };
}

export async function createAppCompositionFromSettings(): Promise<AppComposition> {
  const settings = await new SettingsSqliteRepository().get();
  return createAppComposition(settings.projectRoots);
}
