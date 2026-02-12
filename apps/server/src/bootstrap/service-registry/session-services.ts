import type { SessionServiceFactory } from "@/modules/service-factories";
import {
  BootstrapSessionConnectionService,
  CleanupProjectSessionsService,
  CompactSessionMessagesService,
  CreateSessionService,
  DeleteSessionService,
  GetSessionMessagesService,
  GetSessionStateService,
  GetSessionStorageStatsService,
  ListSessionsService,
  PersistSessionBootstrapService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  SessionAcpBootstrapService,
  SessionHistoryReplayService,
  SessionMcpConfigService,
  SessionMessageMapper,
  SessionMetadataPersistenceService,
  SessionProcessLifecycleService,
  SessionProjectContextResolverService,
  SessionRuntimeBootstrapService,
  SpawnSessionProcessService,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createSessionServices(
  deps: ServiceRegistryDependencies
): SessionServiceFactory {
  const projectContextResolver = new SessionProjectContextResolverService(
    deps.projectRepo,
    deps.settingsRepo
  );
  const runtimeBootstrap = new SessionRuntimeBootstrapService(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.sessionAcpAdapter
  );
  const messageMapper = new SessionMessageMapper(deps.sessionRuntime);
  const historyReplay = new SessionHistoryReplayService(
    deps.sessionRepo,
    deps.sessionRuntime,
    messageMapper,
    deps.appLogger
  );
  const mcpConfig = new SessionMcpConfigService(deps.settingsRepo);
  const acpBootstrap = new SessionAcpBootstrapService(
    deps.sessionRuntime,
    deps.sessionRepo,
    deps.sessionAcpAdapter,
    deps.agentRuntimeAdapter,
    mcpConfig,
    historyReplay,
    deps.appLogger,
    () => ({
      defaultModel: deps.appConfigService.getConfig().defaultModel,
    })
  );
  const processLifecycle = new SessionProcessLifecycleService(
    deps.sessionRuntime,
    deps.sessionRepo,
    deps.appLogger
  );
  const metadataPersistence = new SessionMetadataPersistenceService(
    deps.sessionRepo
  );
  const spawnSessionProcess = new SpawnSessionProcessService(
    deps.agentRuntimeAdapter
  );
  const bootstrapSessionConnection = new BootstrapSessionConnectionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    runtimeBootstrap,
    acpBootstrap,
    processLifecycle
  );
  const persistSessionBootstrap = new PersistSessionBootstrapService(
    metadataPersistence
  );
  const createSessionService = new CreateSessionService(
    projectContextResolver,
    spawnSessionProcess,
    bootstrapSessionConnection,
    persistSessionBootstrap,
    deps.appLogger
  );
  const stopSessionService = new StopSessionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.eventBus
  );
  const resumeSessionService = new ResumeSessionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    createSessionService
  );
  const deleteSessionService = new DeleteSessionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.eventBus
  );
  const getSessionStateService = new GetSessionStateService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const listSessionsService = new ListSessionsService(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.projectRepo
  );
  const updateSessionMetaService = new UpdateSessionMetaService(
    deps.sessionRepo
  );
  const getSessionMessagesService = new GetSessionMessagesService(
    deps.sessionRepo
  );
  const getSessionStorageStatsService = new GetSessionStorageStatsService(
    deps.sessionRepo
  );
  const subscribeSessionEventsService = new SubscribeSessionEventsService(
    deps.sessionRuntime
  );
  const cleanupProjectSessionsService = new CleanupProjectSessionsService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const reconcileSessionStatusService = new ReconcileSessionStatusService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const compactSessionMessagesService = new CompactSessionMessagesService(
    deps.sessionRepo
  );

  return {
    createSession: () => createSessionService,
    stopSession: () => stopSessionService,
    resumeSession: () => resumeSessionService,
    deleteSession: () => deleteSessionService,
    getSessionState: () => getSessionStateService,
    listSessions: () => listSessionsService,
    updateSessionMeta: () => updateSessionMetaService,
    getSessionMessagesPage: () => getSessionMessagesService,
    getSessionStorageStats: () => getSessionStorageStatsService,
    subscribeSessionEvents: () => subscribeSessionEventsService,
    cleanupProjectSessions: () => cleanupProjectSessionsService,
    reconcileSessionStatus: () => reconcileSessionStatusService,
    compactSessionMessages: () => compactSessionMessagesService,
  };
}
