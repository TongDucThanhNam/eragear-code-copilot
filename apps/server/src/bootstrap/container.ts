/**
 * Dependency Injection Container
 *
 * Holds core dependencies and lazily initializes singleton service factories.
 *
 * @module bootstrap/container
 */

import type { AgentRepositoryPort } from "@/modules/agent";
import type { SendMessagePolicy } from "@/modules/ai";
import type { ProjectRepositoryPort } from "@/modules/project";
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
  AgentRuntimePort,
  SessionAcpPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type {
  AppConfigService,
  SettingsRepositoryPort,
} from "@/modules/settings";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { AuthContext } from "../platform/auth/guards";
import { getResponseCache } from "../platform/caching/response-cache";
import type { CacheStats } from "../platform/caching/types";
import type { GitAdapter } from "../platform/git";
import { createAgentServices } from "./service-registry/agent-services";
import { createAiServices } from "./service-registry/ai-services";
import type { ServiceRegistryDependencies } from "./service-registry/dependencies";
import { createOpsServices } from "./service-registry/ops-services";
import { createProjectServices } from "./service-registry/project-services";
import { createSessionServices } from "./service-registry/session-services";
import { createSettingsServices } from "./service-registry/settings-services";
import { createToolingServices } from "./service-registry/tooling-services";

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

export class Container {
  private readonly eventBus: EventBusPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logStore: LogStorePort;
  private readonly appLogger: LoggerPort;
  private readonly clock: ClockPort;
  private readonly authContextResolver: ContainerDependencies["resolveAuthContext"];
  private readonly sendMessagePolicy: SendMessagePolicy;
  private readonly appConfigService: AppConfigService;
  private readonly serviceRegistryDependencies: ServiceRegistryDependencies;
  private backgroundRunnerStateProvider:
    | (() => BackgroundRunnerState)
    | undefined;

  private sessionServices: SessionServiceFactory | undefined;
  private aiServices: AiServiceFactory | undefined;
  private projectServices: ProjectServiceFactory | undefined;
  private agentServices: AgentServiceFactory | undefined;
  private settingsServices: SettingsServiceFactory | undefined;
  private toolingServices: ToolingServiceFactory | undefined;
  private opsServices: OpsServiceFactory | undefined;

  private readonly sessionRepo: SessionRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly agentRepo: AgentRepositoryPort;
  private readonly settingsRepo: SettingsRepositoryPort;

  private readonly gitAdapter: GitAdapter;
  private readonly agentRuntimeAdapter: AgentRuntimePort;
  private readonly sessionAcpAdapter: SessionAcpPort;

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
    this.serviceRegistryDependencies = {
      eventBus: this.eventBus,
      sessionRuntime: this.sessionRuntime,
      logStore: this.logStore,
      appLogger: this.appLogger,
      clock: this.clock,
      sessionRepo: this.sessionRepo,
      projectRepo: this.projectRepo,
      agentRepo: this.agentRepo,
      settingsRepo: this.settingsRepo,
      appConfigService: this.appConfigService,
      gitAdapter: this.gitAdapter,
      agentRuntimeAdapter: this.agentRuntimeAdapter,
      sessionAcpAdapter: this.sessionAcpAdapter,
      sendMessagePolicy: this.sendMessagePolicy,
      getCacheStats: this.getCacheStats.bind(this),
      getBackgroundRunnerState: this.getBackgroundRunnerState.bind(this),
    };
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
      this.sessionServices = createSessionServices(
        this.serviceRegistryDependencies
      );
    }
    return this.sessionServices;
  }

  getAiServices(): AiServiceFactory {
    if (!this.aiServices) {
      this.aiServices = createAiServices(this.serviceRegistryDependencies);
    }
    return this.aiServices;
  }

  getProjectServices(): ProjectServiceFactory {
    if (!this.projectServices) {
      this.projectServices = createProjectServices(
        this.serviceRegistryDependencies
      );
    }
    return this.projectServices;
  }

  getAgentServices(): AgentServiceFactory {
    if (!this.agentServices) {
      this.agentServices = createAgentServices(
        this.serviceRegistryDependencies
      );
    }
    return this.agentServices;
  }

  getSettingsServices(): SettingsServiceFactory {
    if (!this.settingsServices) {
      this.settingsServices = createSettingsServices(
        this.serviceRegistryDependencies
      );
    }
    return this.settingsServices;
  }

  getToolingServices(): ToolingServiceFactory {
    if (!this.toolingServices) {
      this.toolingServices = createToolingServices(
        this.serviceRegistryDependencies
      );
    }
    return this.toolingServices;
  }

  getOpsServices(): OpsServiceFactory {
    if (!this.opsServices) {
      this.opsServices = createOpsServices(this.serviceRegistryDependencies);
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
