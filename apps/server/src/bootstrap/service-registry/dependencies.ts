import type { AgentRepositoryPort } from "@/modules/agent";
import type { SendMessagePolicy } from "@/modules/ai";
import type { ProjectRepositoryPort } from "@/modules/project";
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
import type { CacheStats } from "@/platform/caching/types";
import type { GitAdapter } from "@/platform/git";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";

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
  appConfigService: AppConfigService;
  gitAdapter: GitAdapter;
  agentRuntimeAdapter: AgentRuntimePort;
  sessionAcpAdapter: SessionAcpPort;
  sendMessagePolicy: SendMessagePolicy;
  sessionUiMessageLimit: number;
  getCacheStats: () => CacheStats;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}
