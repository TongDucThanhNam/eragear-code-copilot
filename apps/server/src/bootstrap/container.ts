/**
 * Dependency Injection Container
 *
 * Creates and wires all adapters, repositories, and services for the application.
 * Implements the dependency inversion principle by injecting ports (interfaces)
 * with concrete implementations (adapters).
 *
 * @module bootstrap/container
 */

import {
  type AgentRepositoryPort,
  CreateAgentService,
  DeleteAgentService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "@/modules/agent";
import {
  AgentSqliteRepository,
  AgentSqliteWorkerRepository,
} from "@/modules/agent/di";
import {
  CancelPromptService,
  SendMessageService,
  SetModelService,
  SetModeService,
} from "@/modules/ai";
import {
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
import {
  ProjectSqliteRepository,
  ProjectSqliteWorkerRepository,
} from "@/modules/project/di";
import {
  type AgentRuntimePort,
  CleanupProjectSessionsService,
  CreateSessionService,
  DeleteSessionService,
  GetSessionMessagesService,
  GetSessionStateService,
  GetSessionStorageStatsService,
  ListSessionsService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  type SessionAcpPort,
  type SessionRepositoryPort,
  type SessionRuntimePort,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import {
  SessionAcpAdapter,
  SessionRuntimeStore,
  SessionSqliteRepository,
  SessionSqliteWorkerRepository,
} from "@/modules/session/di";
import {
  GetSettingsService,
  type SettingsRepositoryPort,
  UpdateSettingsService,
} from "@/modules/settings";
import {
  SettingsSqliteRepository,
  SettingsSqliteWorkerRepository,
} from "@/modules/settings/di";
import {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import { ENV } from "../config/environment";
import { auth, authDb } from "../platform/auth/auth";
import { getAuthContext } from "../platform/auth/guards";
import { getResponseCache } from "../platform/caching/response-cache";
import type { CacheStats } from "../platform/caching/types";
import { GitAdapter } from "../platform/git";
import { getLogStore } from "../platform/logging/log-store";
import { createAppLogger } from "../platform/logging/logger-adapter";
import { AgentRuntimeAdapter } from "../platform/process";
import { initializeSqliteWorker } from "../platform/storage/sqlite-worker-client";
import { EventBus } from "../shared/utils/event-bus";

export interface SessionServiceFactory {
  createSession(): CreateSessionService;
  stopSession(): StopSessionService;
  resumeSession(): ResumeSessionService;
  deleteSession(): DeleteSessionService;
  getSessionState(): GetSessionStateService;
  listSessions(): ListSessionsService;
  updateSessionMeta(): UpdateSessionMetaService;
  getSessionMessages(): GetSessionMessagesService;
  getSessionStorageStats(): GetSessionStorageStatsService;
  subscribeSessionEvents(): SubscribeSessionEventsService;
  cleanupProjectSessions(): CleanupProjectSessionsService;
  reconcileSessionStatus(): ReconcileSessionStatusService;
}

export interface AiServiceFactory {
  sendMessage(): SendMessageService;
  setModel(): SetModelService;
  setMode(): SetModeService;
  cancelPrompt(): CancelPromptService;
}

export interface ProjectServiceFactory {
  listProjects(): ListProjectsService;
  createProject(): CreateProjectService;
  updateProject(): UpdateProjectService;
  deleteProject(): DeleteProjectService;
  setActiveProject(): SetActiveProjectService;
}

export interface AgentServiceFactory {
  listAgents(): ListAgentsService;
  createAgent(): CreateAgentService;
  updateAgent(): UpdateAgentService;
  deleteAgent(): DeleteAgentService;
  setActiveAgent(): SetActiveAgentService;
}

export interface SettingsServiceFactory {
  getSettings(): GetSettingsService;
  updateSettings(): UpdateSettingsService;
}

export interface ToolingServiceFactory {
  codeContext(): CodeContextService;
  respondPermission(): RespondPermissionService;
}

export interface OpsServiceFactory {
  observabilitySnapshot(): GetObservabilitySnapshotService;
  dashboardProjects(): ListDashboardProjectsService;
  dashboardSessions(): ListDashboardSessionsService;
  dashboardStats(): GetDashboardStatsService;
  dashboardPageData(): GetDashboardPageDataService;
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

  /**
   * Creates a new Container instance
   * @param allowedRoots - Array of allowed project root paths
   */
  constructor(allowedRoots: string[] = [process.cwd()]) {
    // Core services
    this.eventBus = new EventBus();
    this.sessionRuntime = new SessionRuntimeStore(this.eventBus);
    this.logStore = getLogStore();
    this.appLogger = createAppLogger("Debug");

    if (ENV.sqliteWorkerEnabled) {
      initializeSqliteWorker(allowedRoots);

      // SQLite IO runs in dedicated worker thread.
      this.sessionRepo = new SessionSqliteWorkerRepository();
      this.projectRepo = new ProjectSqliteWorkerRepository();
      this.agentRepo = new AgentSqliteWorkerRepository();
      this.settingsRepo = new SettingsSqliteWorkerRepository();
    } else {
      // Initialize repositories
      this.sessionRepo = new SessionSqliteRepository();
      this.projectRepo = new ProjectSqliteRepository(allowedRoots);
      this.agentRepo = new AgentSqliteRepository();
      this.settingsRepo = new SettingsSqliteRepository();
    }

    // Initialize adapters
    this.gitAdapter = new GitAdapter();
    this.agentRuntimeAdapter = new AgentRuntimeAdapter();
    this.sessionAcpAdapter = new SessionAcpAdapter();

    this.registerDomainEventHandlers();
  }

  private registerDomainEventHandlers(): void {
    this.eventBus.subscribe(async (event) => {
      if (event.type !== "project_deleting") {
        return;
      }

      const service = this.getSessionServices().cleanupProjectSessions();
      await service.execute({
        projectId: event.projectId,
        projectPath: event.projectPath,
      });
    });
  }

  /**
   * Gets the event bus instance
   * @returns The event bus for publishing and subscribing to events
   */
  getEventBus(): EventBusPort {
    return this.eventBus;
  }

  /**
   * Gets the session runtime store
   * @returns The session runtime port for managing active sessions
   */
  getSessionRuntime(): SessionRuntimePort {
    return this.sessionRuntime;
  }

  /**
   * Gets the log store instance
   * @returns The log store for log retrieval
   */
  getLogStore(): LogStorePort {
    return this.logStore;
  }

  /**
   * Gets the shared application logger
   * @returns Logger port implementation
   */
  getAppLogger(): LoggerPort {
    return this.appLogger;
  }

  /**
   * Gets response cache statistics
   * @returns Cache stats snapshot
   */
  getCacheStats(): CacheStats {
    return getResponseCache().getStats();
  }

  /**
   * Registers background runner state provider
   * @param provider - Function returning current background runner state
   */
  setBackgroundRunnerStateProvider(
    provider: () => BackgroundRunnerState
  ): void {
    this.backgroundRunnerStateProvider = provider;
  }

  /**
   * Gets background runner state snapshot
   * @returns Background runner state or null when runner is not configured
   */
  getBackgroundRunnerState(): BackgroundRunnerState | null {
    if (!this.backgroundRunnerStateProvider) {
      return null;
    }
    return this.backgroundRunnerStateProvider();
  }

  /**
   * Gets the session repository
   * @returns The session repository for session persistence
   */
  getSessions(): SessionRepositoryPort {
    return this.sessionRepo;
  }

  /**
   * Gets the project repository
   * @returns The project repository for project management
   */
  getProjects(): ProjectRepositoryPort {
    return this.projectRepo;
  }

  /**
   * Gets the agent repository
   * @returns The agent repository for agent management
   */
  getAgents(): AgentRepositoryPort {
    return this.agentRepo;
  }

  /**
   * Gets the settings repository
   * @returns The settings repository for accessing settings
   */
  getSettings(): SettingsRepositoryPort {
    return this.settingsRepo;
  }

  /**
   * Gets the agent runtime adapter
   * @returns The agent runtime port for spawning agent processes
   */
  getAgentRuntime(): AgentRuntimePort {
    return this.agentRuntimeAdapter;
  }

  /**
   * Gets the ACP session adapter
   * @returns The ACP session adapter
   */
  getSessionAcp(): SessionAcpPort {
    return this.sessionAcpAdapter;
  }

  /**
   * Gets session use-case factories.
   */
  getSessionServices(): SessionServiceFactory {
    if (!this.sessionServices) {
      this.sessionServices = {
        createSession: () =>
          new CreateSessionService(
            this.sessionRepo,
            this.sessionRuntime,
            this.agentRuntimeAdapter,
            this.settingsRepo,
            this.projectRepo,
            this.sessionAcpAdapter
          ),
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
            this.agentRuntimeAdapter,
            this.settingsRepo,
            this.projectRepo,
            this.sessionAcpAdapter
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
        getSessionMessages: () =>
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
      };
    }

    return this.sessionServices;
  }

  /**
   * Gets AI use-case factories.
   */
  getAiServices(): AiServiceFactory {
    if (!this.aiServices) {
      this.aiServices = {
        sendMessage: () =>
          new SendMessageService(
            this.sessionRepo,
            this.sessionRuntime,
            this.appLogger
          ),
        setModel: () =>
          new SetModelService(this.sessionRuntime, this.sessionRepo),
        setMode: () =>
          new SetModeService(this.sessionRuntime, this.sessionRepo),
        cancelPrompt: () => new CancelPromptService(this.sessionRuntime),
      };
    }

    return this.aiServices;
  }

  /**
   * Gets project use-case factories.
   */
  getProjectServices(): ProjectServiceFactory {
    if (!this.projectServices) {
      this.projectServices = {
        listProjects: () => new ListProjectsService(this.projectRepo),
        createProject: () =>
          new CreateProjectService(this.projectRepo, this.eventBus),
        updateProject: () =>
          new UpdateProjectService(this.projectRepo, this.eventBus),
        deleteProject: () =>
          new DeleteProjectService(this.projectRepo, this.eventBus),
        setActiveProject: () =>
          new SetActiveProjectService(this.projectRepo, this.eventBus),
      };
    }

    return this.projectServices;
  }

  /**
   * Gets agent use-case factories.
   */
  getAgentServices(): AgentServiceFactory {
    if (!this.agentServices) {
      this.agentServices = {
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

  /**
   * Gets settings use-case factories.
   */
  getSettingsServices(): SettingsServiceFactory {
    if (!this.settingsServices) {
      this.settingsServices = {
        getSettings: () => new GetSettingsService(this.settingsRepo),
        updateSettings: () =>
          new UpdateSettingsService(
            this.settingsRepo,
            this.projectRepo,
            this.eventBus
          ),
      };
    }

    return this.settingsServices;
  }

  /**
   * Gets tooling use-case factories.
   */
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

  /**
   * Gets operational use-case factories.
   */
  getOpsServices(): OpsServiceFactory {
    if (!this.opsServices) {
      const dashboardProjects = new ListDashboardProjectsService(
        this.projectRepo,
        this.sessionRepo
      );
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

  /**
   * Gets the git adapter
   * @returns The git adapter for git operations
   */
  getGit(): GitAdapter {
    return this.gitAdapter;
  }

  /**
   * Gets the auth service instance
   * @returns The auth service for authentication operations
   */
  getAuth() {
    return auth;
  }

  /**
   * Gets the auth database instance
   * @returns The database for auth queries
   */
  getAuthDb() {
    return authDb;
  }

  /**
   * Resolves auth context from a request-like object
   * @param req - Request-like object containing headers and URL
   * @returns The resolved auth context or null
   */
  getAuthContext(req?: Parameters<typeof getAuthContext>[0]) {
    return getAuthContext(req);
  }
}

/** Singleton container instance */
let containerInstance: Container | null = null;

/**
 * Initializes the container with optional allowed roots
 * @param allowedRoots - Optional array of allowed project root paths
 * @returns The initialized container instance
 */
export function initializeContainer(allowedRoots?: string[]): Container {
  containerInstance = new Container(allowedRoots);
  return containerInstance;
}

export async function initializeContainerFromSettings(): Promise<Container> {
  const settings = await new SettingsSqliteRepository().get();
  return initializeContainer(settings.projectRoots);
}

/**
 * Gets the singleton container instance
 * Creates a new instance if one doesn't exist
 * @returns The container instance
 */
export function getContainer(): Container {
  if (!containerInstance) {
    containerInstance = new Container();
  }
  return containerInstance;
}
