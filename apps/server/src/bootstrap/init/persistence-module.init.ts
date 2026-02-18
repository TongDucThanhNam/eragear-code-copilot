import type { AgentRepositoryPort } from "@/modules/agent";
import {
  AgentSqliteRepository,
  AgentSqliteWorkerRepository,
} from "@/modules/agent/di";
import type { ProjectRepositoryPort } from "@/modules/project";
import {
  ProjectSqliteRepository,
  ProjectSqliteWorkerRepository,
} from "@/modules/project/di";
import type { SessionRepositoryPort } from "@/modules/session";
import { createSessionRepository } from "@/modules/session/di";
import type {
  AppConfigService,
  SettingsRepositoryPort,
} from "@/modules/settings";
import {
  SettingsSqliteRepository,
  SettingsSqliteWorkerRepository,
} from "@/modules/settings/di";

export interface PersistenceModule {
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;
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
  };
}
