import type { AgentRepositoryPort } from "#runtime/modules/agent";
import type {
  OutputStylePromptPort,
  PromptEnhancerPort,
  SendMessagePolicy,
} from "#runtime/modules/ai";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import type {
  AgentRuntimePort,
  SessionAcpPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "#runtime/modules/session";
import type {
  AppConfigService,
  SettingsRepositoryPort,
} from "#runtime/modules/settings";
import type { SupervisorPolicy } from "#runtime/modules/supervisor";
import type { UsageStatsRepositoryPort } from "#runtime/modules/usage-stats";
import type { CacheStats } from "#runtime/platform/caching/types";
import type { GitAdapter } from "#runtime/platform/git";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { LogStorePort } from "#runtime/shared/ports/log-store.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { BackgroundRunnerState } from "#runtime/shared/types/background.types";

export interface ServiceRegistryDependencies {
  eventBus: EventBusPort;
  sessionRuntime: SessionRuntimePort;
  logStore: LogStorePort;
  appLogger: LoggerPort;
  clock: ClockPort;
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
  usageStatsRepo: UsageStatsRepositoryPort;
  appConfigService: AppConfigService;
  gitAdapter: GitAdapter;
  agentRuntimeAdapter: AgentRuntimePort;
  sessionAcpAdapter: SessionAcpPort;
  sendMessagePolicy: SendMessagePolicy;
  promptEnhancer?: PromptEnhancerPort;
  outputStylePrompt?: OutputStylePromptPort;
  supervisorPolicy: SupervisorPolicy;
  sessionUiMessageLimit: number;
  getCacheStats: () => CacheStats;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}

export type ServiceRegistrySlice<
  TKeys extends keyof ServiceRegistryDependencies,
> = Pick<ServiceRegistryDependencies, TKeys>;
