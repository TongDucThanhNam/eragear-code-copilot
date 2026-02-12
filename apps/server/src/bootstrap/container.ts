/**
 * Dependency Injection Container
 *
 * Holds pre-built dependencies and lazily exposes service factories.
 * Composition lives in bootstrap/composition.ts.
 *
 * @module bootstrap/container
 */

import {
  type AgentRepositoryPort,
  CreateAgentService,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "@/modules/agent";
import {
  CancelPromptService,
  PromptTaskRunner,
  type SendMessagePolicy,
  SendMessageService,
  SetModelService,
  SetModeService,
} from "@/modules/ai";
import { AiSessionRuntimeAdapter } from "@/modules/ai/di";
import {
  DashboardEventVisibilityService,
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "@/modules/ops";
import {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  type ProjectRepositoryPort,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type {
  AgentServiceFactory,
  AiServiceFactory,
  OpsServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
  ToolingServiceFactory,
} from "@/modules/service-factories";
import {
  type AgentRuntimePort,
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
  type SessionAcpPort,
  SessionHistoryReplayService,
  SessionMcpConfigService,
  SessionMessageMapper,
  SessionMetadataPersistenceService,
  SessionProcessLifecycleService,
  SessionProjectContextResolverService,
  type SessionRepositoryPort,
  SessionRuntimeBootstrapService,
  type SessionRuntimePort,
  SpawnSessionProcessService,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import {
  type AppConfigService,
  GetSettingsService,
  type SettingsRepositoryPort,
  UpdateSettingsService,
} from "@/modules/settings";
import {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { AuthContext } from "../platform/auth/guards";
import { getResponseCache } from "../platform/caching/response-cache";
import type { CacheStats } from "../platform/caching/types";
import type { GitAdapter } from "../platform/git";

export type {
  AgentServiceFactory,
  AiServiceFactory,
  OpsServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
  ToolingServiceFactory,
} from "@/modules/service-factories";

export interface ContainerDependencies {
  eventBus: EventBusPort;
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  clock: ClockPort;
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
  appConfigService: AppConfigService;
  gitAdapter: GitAdapter;
  agentRuntimeAdapter: AgentRuntimePort;
  sessionAcpAdapter: SessionAcpPort;
  resolveAuthContext: (req?: {
    headers: Headers | Record<string, string | string[] | undefined>;
    url?: string;
  }) => Promise<AuthContext | null>;
  sendMessagePolicy: SendMessagePolicy;
}

/**
 * Main dependency injection container
 * Provides access to all repositories, adapters, and services in the application
 */
export class Container {
  /** Event bus for cross-session event communication */
  private readonly eventBus: EventBusPort;
  /** Runtime store for active chat sessions */
  private readonly sessionRuntime: SessionRuntimePort;
  /** Log store for server and request logs */
  private readonly logStore: LogStorePort;
  /** Application logger port for use-cases */
  private readonly appLogger: LoggerPort;
  /** Clock for deterministic time usage in services */
  private readonly clock: ClockPort;
  /** Auth context resolver */
  private readonly authContextResolver: ContainerDependencies["resolveAuthContext"];
  /** Policy for send-message use-case */
  private readonly sendMessagePolicy: SendMessagePolicy;
  /** Runtime app configuration service */
  private readonly appConfigService: AppConfigService;
  /** Background runner state provider */
  private backgroundRunnerStateProvider:
    | (() => BackgroundRunnerState)
    | undefined;
  /** Session service factory */
  private sessionServices: SessionServiceFactory | undefined;
  /** AI service factory */
  private aiServices: AiServiceFactory | undefined;
  /** Project service factory */
  private projectServices: ProjectServiceFactory | undefined;
  /** Agent service factory */
  private agentServices: AgentServiceFactory | undefined;
  /** Settings service factory */
  private settingsServices: SettingsServiceFactory | undefined;
  /** Tooling service factory */
  private toolingServices: ToolingServiceFactory | undefined;
  /** Operations service factory */
  private opsServices: OpsServiceFactory | undefined;

  // Repositories
  /** Session repository for persisting session metadata and messages */
  sessionRepo: SessionRepositoryPort;
  /** Project repository for managing project configurations */
  projectRepo: ProjectRepositoryPort;
  /** Agent repository for managing agent configurations */
  agentRepo: AgentRepositoryPort;
  /** Settings repository for managing application settings */
  settingsRepo: SettingsRepositoryPort;

  // Adapters
  /** Git adapter for git operations and project context */
  gitAdapter: GitAdapter;
  /** Agent runtime adapter for spawning and managing agent processes */
  agentRuntimeAdapter: AgentRuntimePort;
  /** ACP session adapter for ACP handlers and buffering */
  sessionAcpAdapter: SessionAcpPort;

  constructor(deps: ContainerDependencies) {
    this.eventBus = deps.eventBus;
    this.sessionRuntime = deps.sessionRuntime;
    this.logStore = deps.logStore;
    this.appLogger = deps.appLogger;
    this.clock = deps.clock;

    this.sessionRepo = deps.sessionRepo;
    this.projectRepo = deps.projectRepo;
    this.agentRepo = deps.agentRepo;
    this.settingsRepo = deps.settingsRepo;
    this.appConfigService = deps.appConfigService;

    this.gitAdapter = deps.gitAdapter;
    this.agentRuntimeAdapter = deps.agentRuntimeAdapter;
    this.sessionAcpAdapter = deps.sessionAcpAdapter;

    this.authContextResolver = deps.resolveAuthContext;
    this.sendMessagePolicy = deps.sendMessagePolicy;
  }

  getEventBus(): EventBusPort {
    return this.eventBus;
  }

  getSessionRuntime(): SessionRuntimePort {
    return this.sessionRuntime;
  }

  getLogStore(): LogStorePort {
    return this.logStore;
  }

  getAppLogger(): LoggerPort {
    return this.appLogger;
  }

  getCacheStats(): CacheStats {
    return getResponseCache().getStats();
  }

  setBackgroundRunnerStateProvider(
    provider: () => BackgroundRunnerState
  ): void {
    this.backgroundRunnerStateProvider = provider;
  }

  getBackgroundRunnerState(): BackgroundRunnerState | null {
    if (!this.backgroundRunnerStateProvider) {
      return null;
    }
    return this.backgroundRunnerStateProvider();
  }

  getSessions(): SessionRepositoryPort {
    return this.sessionRepo;
  }

  getProjects(): ProjectRepositoryPort {
    return this.projectRepo;
  }

  getAgents(): AgentRepositoryPort {
    return this.agentRepo;
  }

  getSettings(): SettingsRepositoryPort {
    return this.settingsRepo;
  }

  getAppConfigService(): AppConfigService {
    return this.appConfigService;
  }

  getAgentRuntime(): AgentRuntimePort {
    return this.agentRuntimeAdapter;
  }

  getSessionAcp(): SessionAcpPort {
    return this.sessionAcpAdapter;
  }

  getSessionServices(): SessionServiceFactory {
    if (!this.sessionServices) {
      const buildCreateSessionService = () => {
        const projectContextResolver = new SessionProjectContextResolverService(
          this.projectRepo,
          this.settingsRepo
        );
        const runtimeBootstrap = new SessionRuntimeBootstrapService(
          this.sessionRepo,
          this.sessionRuntime,
          this.sessionAcpAdapter
        );
        const messageMapper = new SessionMessageMapper(this.sessionRuntime);
        const historyReplay = new SessionHistoryReplayService(
          this.sessionRepo,
          this.sessionRuntime,
          messageMapper,
          this.appLogger
        );
        const mcpConfig = new SessionMcpConfigService(this.settingsRepo);
        const acpBootstrap = new SessionAcpBootstrapService(
          this.sessionRuntime,
          this.sessionRepo,
          this.sessionAcpAdapter,
          this.agentRuntimeAdapter,
          mcpConfig,
          historyReplay,
          this.appLogger,
          () => ({
            defaultModel: this.appConfigService.getConfig().defaultModel,
          })
        );
        const processLifecycle = new SessionProcessLifecycleService(
          this.sessionRuntime,
          this.sessionRepo,
          this.appLogger
        );
        const metadataPersistence = new SessionMetadataPersistenceService(
          this.sessionRepo
        );
        const spawnSessionProcess = new SpawnSessionProcessService(
          this.agentRuntimeAdapter
        );
        const bootstrapSessionConnection =
          new BootstrapSessionConnectionService(
            this.sessionRepo,
            this.sessionRuntime,
            runtimeBootstrap,
            acpBootstrap,
            processLifecycle
          );
        const persistSessionBootstrap = new PersistSessionBootstrapService(
          metadataPersistence
        );

        return new CreateSessionService(
          projectContextResolver,
          spawnSessionProcess,
          bootstrapSessionConnection,
          persistSessionBootstrap,
          this.appLogger
        );
      };

      this.sessionServices = {
        createSession: () => buildCreateSessionService(),
        stopSession: () =>
          new StopSessionService(
            this.sessionRepo,
            this.sessionRuntime,
            this.eventBus
          ),
        resumeSession: () =>
          new ResumeSessionService(
            this.sessionRepo,
            this.sessionRuntime,
            buildCreateSessionService()
          ),
        deleteSession: () =>
          new DeleteSessionService(
            this.sessionRepo,
            this.sessionRuntime,
            this.eventBus
          ),
        getSessionState: () =>
          new GetSessionStateService(this.sessionRepo, this.sessionRuntime),
        listSessions: () =>
          new ListSessionsService(
            this.sessionRepo,
            this.sessionRuntime,
            this.projectRepo
          ),
        updateSessionMeta: () => new UpdateSessionMetaService(this.sessionRepo),
        getSessionMessagesPage: () =>
          new GetSessionMessagesService(this.sessionRepo),
        getSessionStorageStats: () =>
          new GetSessionStorageStatsService(this.sessionRepo),
        subscribeSessionEvents: () =>
          new SubscribeSessionEventsService(this.sessionRuntime),
        cleanupProjectSessions: () =>
          new CleanupProjectSessionsService(
            this.sessionRepo,
            this.sessionRuntime
          ),
        reconcileSessionStatus: () =>
          new ReconcileSessionStatusService(
            this.sessionRepo,
            this.sessionRuntime
          ),
        compactSessionMessages: () =>
          new CompactSessionMessagesService(this.sessionRepo),
      };
    }

    return this.sessionServices;
  }

  getAiServices(): AiServiceFactory {
    if (!this.aiServices) {
      const buildSessionGateway = () =>
        new AiSessionRuntimeAdapter(this.sessionRuntime, this.sessionRepo);
      this.aiServices = {
        sendMessage: () => {
          const sessionGateway = buildSessionGateway();
          const promptTaskRunner = new PromptTaskRunner({
            sessionRepo: this.sessionRepo,
            sessionGateway,
            logger: this.appLogger,
            clock: this.clock,
            policy: {
              acpRetryMaxAttempts: this.sendMessagePolicy.acpRetryMaxAttempts,
              acpRetryBaseDelayMs: this.sendMessagePolicy.acpRetryBaseDelayMs,
            },
            runtimePolicyProvider: () => ({
              maxTokens: this.appConfigService.getConfig().maxTokens,
            }),
          });
          return new SendMessageService({
            sessionRepo: this.sessionRepo,
            sessionRuntime: this.sessionRuntime,
            sessionGateway,
            promptTaskRunner,
            logger: this.appLogger,
            inputPolicy: this.sendMessagePolicy,
            clock: this.clock,
          });
        },
        setModel: () =>
          new SetModelService(buildSessionGateway(), {
            acpRetryMaxAttempts: this.sendMessagePolicy.acpRetryMaxAttempts,
            acpRetryBaseDelayMs: this.sendMessagePolicy.acpRetryBaseDelayMs,
          }),
        setMode: () =>
          new SetModeService(buildSessionGateway(), {
            acpRetryMaxAttempts: this.sendMessagePolicy.acpRetryMaxAttempts,
            acpRetryBaseDelayMs: this.sendMessagePolicy.acpRetryBaseDelayMs,
          }),
        cancelPrompt: () =>
          new CancelPromptService(this.sessionRuntime, buildSessionGateway()),
      };
    }

    return this.aiServices;
  }

  getProjectServices(): ProjectServiceFactory {
    if (!this.projectServices) {
      this.projectServices = {
        listProjects: () => new ListProjectsService(this.projectRepo),
        createProject: () =>
          new CreateProjectService(
            this.projectRepo,
            this.settingsRepo,
            this.eventBus
          ),
        updateProject: () =>
          new UpdateProjectService(
            this.projectRepo,
            this.settingsRepo,
            this.eventBus
          ),
        deleteProject: () =>
          new DeleteProjectService(this.projectRepo, this.eventBus),
        setActiveProject: () =>
          new SetActiveProjectService(this.projectRepo, this.eventBus),
      };
    }

    return this.projectServices;
  }

  getAgentServices(): AgentServiceFactory {
    if (!this.agentServices) {
      this.agentServices = {
        ensureAgentDefaults: () =>
          new EnsureAgentDefaultsService(this.agentRepo),
        listAgents: () => new ListAgentsService(this.agentRepo),
        createAgent: () =>
          new CreateAgentService(this.agentRepo, this.eventBus),
        updateAgent: () =>
          new UpdateAgentService(this.agentRepo, this.eventBus),
        deleteAgent: () =>
          new DeleteAgentService(this.agentRepo, this.eventBus),
        setActiveAgent: () => new SetActiveAgentService(this.agentRepo),
      };
    }

    return this.agentServices;
  }

  getSettingsServices(): SettingsServiceFactory {
    if (!this.settingsServices) {
      this.settingsServices = {
        getSettings: () => new GetSettingsService(this.settingsRepo),
        updateSettings: () =>
          new UpdateSettingsService(
            this.settingsRepo,
            this.eventBus,
            this.appConfigService
          ),
      };
    }

    return this.settingsServices;
  }

  getToolingServices(): ToolingServiceFactory {
    if (!this.toolingServices) {
      this.toolingServices = {
        codeContext: () =>
          new CodeContextService(this.gitAdapter, this.sessionRuntime),
        respondPermission: () =>
          new RespondPermissionService(this.sessionRuntime),
      };
    }

    return this.toolingServices;
  }

  getOpsServices(): OpsServiceFactory {
    if (!this.opsServices) {
      const dashboardProjects = new ListDashboardProjectsService(
        this.projectRepo,
        this.sessionRepo
      );
      const dashboardEventVisibility = new DashboardEventVisibilityService();
      const dashboardSessions = new ListDashboardSessionsService(
        this.projectRepo,
        this.sessionRepo,
        this.sessionRuntime
      );
      const dashboardStats = new GetDashboardStatsService(
        this.projectRepo,
        this.sessionRepo
      );
      this.opsServices = {
        dashboardEventVisibility: () => dashboardEventVisibility,
        observabilitySnapshot: () =>
          new GetObservabilitySnapshotService({
            sessionRuntime: this.sessionRuntime,
            logStore: this.logStore,
            getCacheStats: () => this.getCacheStats(),
            getBackgroundRunnerState: () => this.getBackgroundRunnerState(),
          }),
        dashboardProjects: () => dashboardProjects,
        dashboardSessions: () => dashboardSessions,
        dashboardStats: () => dashboardStats,
        dashboardPageData: () =>
          new GetDashboardPageDataService({
            listDashboardProjects: dashboardProjects,
            listDashboardSessions: dashboardSessions,
            getDashboardStats: dashboardStats,
            agentRepo: this.agentRepo,
          }),
      };
    }

    return this.opsServices;
  }

  getGit(): GitAdapter {
    return this.gitAdapter;
  }

  getAuthContext(
    req?: Parameters<ContainerDependencies["resolveAuthContext"]>[0]
  ) {
    return this.authContextResolver(req);
  }
}
