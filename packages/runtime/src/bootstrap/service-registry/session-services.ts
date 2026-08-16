import {
  BootstrapSessionConnectionService,
  CleanupProjectSessionsService,
  CreateSessionService,
  createEventBusSessionLifecycleNotifier,
  DeleteSessionService,
  DiscoverAgentSessionsService,
  ForkSessionService,
  ListSessionForksService,
  LoadAgentSessionService,
  PersistSessionBootstrapService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  RollbackConversationService,
  SessionAcpBootstrapService,
  SessionAgentResolverService,
  SessionHistoryReplayService,
  SessionMcpConfigService,
  SessionMessageMapper,
  SessionMetadataPersistenceService,
  SessionProcessLifecycleService,
  SessionProjectContextResolverService,
  SessionQueries,
  SessionRealtimeGate,
  SessionRuntimeBootstrapService,
  SpawnSessionProcessService,
  StopSessionService,
  SubagentService,
  SubscribeSessionEventsService,
  SwitchSessionEnvironmentService,
  UpdateSessionMetaService,
} from "#runtime/modules/session";
import { SessionBindingFileRepository } from "#runtime/modules/session/di";
import type { SessionUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";
import type { ServiceRegistrySlice } from "./dependencies";

type SessionServiceDependencies = ServiceRegistrySlice<
  | "eventBus"
  | "sessionRuntime"
  | "appLogger"
  | "projectRepo"
  | "settingsRepo"
  | "agentRepo"
  | "sessionRepo"
  | "sessionAcpAdapter"
  | "sessionUiMessageLimit"
  | "agentRuntimeAdapter"
  | "appConfigService"
  | "supervisorPolicy"
  | "clock"
  | "gitWorkflowAdapter"
>;

interface SessionServiceRegistryOptions {
  realtimeGate?: SessionRealtimeGate;
}

export function createSessionUseCases(
  deps: SessionServiceDependencies,
  options: SessionServiceRegistryOptions = {}
): SessionUseCases {
  const realtimeGate =
    options.realtimeGate ??
    new SessionRealtimeGate({
      sessionRuntime: deps.sessionRuntime,
      logger: deps.appLogger,
    });
  const sessionLifecycleNotifier = createEventBusSessionLifecycleNotifier(
    deps.eventBus
  );
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
    deps.appLogger,
    sessionLifecycleNotifier
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
    deps.appLogger,
    undefined,
    sessionLifecycleNotifier
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
    sessionLifecycleNotifier
  );
  const resumeSessionService = new ResumeSessionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    createSessionService
  );
  const rollbackConversationService = new RollbackConversationService(
    deps.sessionRepo,
    stopSessionService,
    createSessionService,
    deps.sessionRuntime
  );
  const switchEnvironmentService = new SwitchSessionEnvironmentService(
    deps.sessionRepo,
    deps.projectRepo,
    deps.gitWorkflowAdapter,
    stopSessionService,
    createSessionService,
    deps.sessionRuntime
  );
  const deleteSessionService = new DeleteSessionService(
    deps.sessionRepo,
    deps.sessionRuntime,
    sessionLifecycleNotifier
  );
  const sessionQueries = new SessionQueries(
    deps.sessionRepo,
    deps.sessionRuntime,
    deps.projectRepo,
    () => deps.supervisorPolicy.enabled
  );
  const updateSessionMetaService = new UpdateSessionMetaService(
    deps.sessionRepo
  );
  const subscribeSessionEventsService = new SubscribeSessionEventsService(
    deps.sessionRuntime,
    deps.sessionRepo,
    realtimeGate
  );
  const cleanupProjectSessionsService = new CleanupProjectSessionsService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const reconcileSessionStatusService = new ReconcileSessionStatusService(
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const subagentService = new SubagentService(deps.sessionRuntime, deps.clock);
  const sessionBindingRepository = new SessionBindingFileRepository({
    filePath: () => getStorageFileSync("session-bindings.json"),
  });
  const forkSessionService = new ForkSessionService({
    sessionRepo: deps.sessionRepo,
    bindings: sessionBindingRepository,
    nowMs: deps.clock.nowMs,
  });
  const listSessionForksService = new ListSessionForksService(
    sessionBindingRepository
  );

  return {
    create: createSessionService,
    discoverAgentSessions: discoverAgentSessionsService,
    loadAgentSession: loadAgentSessionService,
    stop: stopSessionService,
    resume: resumeSessionService,
    switchEnvironment: switchEnvironmentService,
    rollbackConversation: rollbackConversationService,
    delete: deleteSessionService,
    queries: sessionQueries,
    updateMeta: updateSessionMetaService,
    events: subscribeSessionEventsService,
    cleanupProjectSessions: cleanupProjectSessionsService,
    reconcileStatus: reconcileSessionStatusService,
    subagents: subagentService,
    fork: forkSessionService,
    forkBindings: listSessionForksService,
  };
}
