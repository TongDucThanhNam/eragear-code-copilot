import {
  DashboardEventVisibilityService,
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "@/modules/ops";
import type { OpsServiceFactory } from "@/modules/service-factories";
import { getTurnIdMigrationSnapshot } from "@/platform/acp/turn-id-observability";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createOpsServices(
  deps: ServiceRegistryDependencies
): OpsServiceFactory {
  const dashboardProjectsService = new ListDashboardProjectsService(
    deps.projectRepo,
    deps.sessionRepo
  );
  const dashboardEventVisibilityService = new DashboardEventVisibilityService();
  const dashboardSessionsService = new ListDashboardSessionsService(
    deps.projectRepo,
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const dashboardStatsService = new GetDashboardStatsService(
    deps.projectRepo,
    deps.sessionRepo
  );
  const observabilitySnapshotService = new GetObservabilitySnapshotService({
    sessionRuntime: deps.sessionRuntime,
    logStore: deps.logStore,
    getCacheStats: deps.getCacheStats,
    getBackgroundRunnerState: deps.getBackgroundRunnerState,
    getAcpTurnIdMigrationSnapshot: getTurnIdMigrationSnapshot,
  });
  const dashboardPageDataService = new GetDashboardPageDataService({
    listDashboardProjects: dashboardProjectsService,
    listDashboardSessions: dashboardSessionsService,
    getDashboardStats: dashboardStatsService,
    agentRepo: deps.agentRepo,
  });

  return {
    dashboardEventVisibility: () => dashboardEventVisibilityService,
    observabilitySnapshot: () => observabilitySnapshotService,
    dashboardProjects: () => dashboardProjectsService,
    dashboardSessions: () => dashboardSessionsService,
    dashboardStats: () => dashboardStatsService,
    dashboardPageData: () => dashboardPageDataService,
  };
}
