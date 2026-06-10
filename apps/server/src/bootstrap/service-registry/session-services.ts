import {
  BootstrapSessionConnectionService,
  CleanupProjectSessionsService,
  CreateSessionService,
  DeleteSessionService,
  DiscoverAgentSessionsService,
  LoadAgentSessionService,
  PersistSessionBootstrapService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  SessionAcpBootstrapService,
  SessionAgentResolverService,
  SessionHistoryReplayService,
  SessionMcpConfigService,
  SessionMessageMapper,
  SessionMetadataPersistenceService,
  SessionProcessLifecycleService,
  SessionProjectContextResolverService,
  SessionQueries,
  SessionRuntimeBootstrapService,
  SpawnSessionProcessService,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import type { SessionUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createSessionUseCases(
  deps: ServiceRegistryDependencies
): SessionUseCases {
  const projectContextResolver = new SessionProjectContextResolverService(
    deps.projectRepo,
    deps.settingsRepo
  );
  const sessionAgentResolver = new SessionAgentResolverService(deps.agentRepo);
  const runtimeBootstrap = new SessionRuntimeBootstrapService(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.sessionAcpAdapter,
    deps.sessionUiMessageLimit
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
    metadataPersistence,
    deps.sessionRepo
  );
  const createSessionService = new CreateSessionService(
    projectContextResolver,
    sessionAgentResolver,
    spawnSessionProcess,
    bootstrapSessionConnection,
    persistSessionBootstrap,
    deps.appLogger
  );
  const discoverAgentSessionsService = new DiscoverAgentSessionsService(
    projectContextResolver,
    sessionAgentResolver,
    spawnSessionProcess,
    deps.agentRuntimeAdapter,
    deps.appLogger
  );
  const loadAgentSessionService = new LoadAgentSessionService(
    createSessionService
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
  const sessionQueries = new SessionQueries(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.projectRepo,
    deps.supervisorPolicy.enabled
  );
  const updateSessionMetaService = new UpdateSessionMetaService(
    deps.sessionRepo
  );
  const subscribeSessionEventsService = new SubscribeSessionEventsService(
    deps.sessionRuntime,
    deps.sessionRepo
  );
  const cleanupProjectSessionsService = new CleanupProjectSessionsService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const reconcileSessionStatusService = new ReconcileSessionStatusService(
    deps.sessionRepo,
    deps.sessionRuntime
  );

  return {
    create: createSessionService,
    discoverAgentSessions: discoverAgentSessionsService,
    loadAgentSession: loadAgentSessionService,
    stop: stopSessionService,
    resume: resumeSessionService,
    delete: deleteSessionService,
    queries: sessionQueries,
    updateMeta: updateSessionMetaService,
    events: subscribeSessionEventsService,
    cleanupProjectSessions: cleanupProjectSessionsService,
    reconcileStatus: reconcileSessionStatusService,
  };
}
