import type { AgentRepositoryPort } from "#runtime/modules/agent";
import {
  AgentSqliteRepository,
  AgentSqliteWorkerRepository,
} from "#runtime/modules/agent/di";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import {
  ProjectSqliteRepository,
  ProjectSqliteWorkerRepository,
} from "#runtime/modules/project/di";
import type { SessionRepositoryPort } from "#runtime/modules/session";
import { createSessionRepository } from "#runtime/modules/session/di";
import type {
  AppConfigService,
  SettingsRepositoryPort,
} from "#runtime/modules/settings";
import {
  SettingsSqliteRepository,
  SettingsSqliteWorkerRepository,
} from "#runtime/modules/settings/di";
import type { SupervisorRunRepositoryPort } from "#runtime/modules/supervisor-orchestration";
import {
  SupervisorRunSqliteRepository,
  SupervisorRunSqliteWorkerRepository,
} from "#runtime/modules/supervisor-orchestration/di";
import type { UsageStatsRepositoryPort } from "#runtime/modules/usage-stats";
import {
  UsageStatsSqliteRepository,
  UsageStatsSqliteWorkerRepository,
} from "#runtime/modules/usage-stats/di";

export interface PersistenceModule {
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
  usageStatsRepo: UsageStatsRepositoryPort;
  supervisorRunRepo: SupervisorRunRepositoryPort;
}

export interface PersistenceModuleInitParams {
  sqliteWorkerEnabled: boolean;
  appConfigService: AppConfigService;
  settingsRepoOverride?: SettingsRepositoryPort;
}

export function initializeSettingsRepository(
  sqliteWorkerEnabled: boolean
): SettingsRepositoryPort {
  if (sqliteWorkerEnabled) {
    return new SettingsSqliteWorkerRepository();
  }
  return new SettingsSqliteRepository();
}

export function initializePersistenceModule(
  params: PersistenceModuleInitParams
): PersistenceModule {
  const { appConfigService, sqliteWorkerEnabled, settingsRepoOverride } =
    params;
  const settingsRepo =
    settingsRepoOverride ?? initializeSettingsRepository(sqliteWorkerEnabled);

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
    usageStatsRepo: sqliteWorkerEnabled
      ? new UsageStatsSqliteWorkerRepository()
      : new UsageStatsSqliteRepository(),
    supervisorRunRepo: sqliteWorkerEnabled
      ? new SupervisorRunSqliteWorkerRepository()
      : new SupervisorRunSqliteRepository(),
  };
}
