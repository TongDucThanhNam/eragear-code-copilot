import {
  DashboardEventVisibilityService,
  DashboardSessionAggregationService,
  GetDashboardOverviewService,
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "#runtime/modules/ops";
import type { OpsUseCases } from "#runtime/modules/use-cases";
import { getTurnIdMigrationSnapshot } from "#runtime/platform/acp/turn-id-observability";
import type { ServiceRegistrySlice } from "./dependencies";

type OpsServiceDependencies = ServiceRegistrySlice<
  | "projectRepo"
  | "sessionRepo"
  | "sessionRuntime"
  | "logStore"
  | "getCacheStats"
  | "getBackgroundRunnerState"
  | "agentRepo"
  | "clock"
>;

export function createOpsUseCases(deps: OpsServiceDependencies): OpsUseCases {
  const dashboardSessionAggregationService =
    new DashboardSessionAggregationService(deps.sessionRepo, deps.clock);
  const dashboardOverviewService = new GetDashboardOverviewService(
    deps.projectRepo,
    dashboardSessionAggregationService
  );
  const dashboardProjectsService = new ListDashboardProjectsService(
    dashboardOverviewService
  );
  const dashboardEventVisibilityService = new DashboardEventVisibilityService();
  const dashboardSessionsService = new ListDashboardSessionsService(
    deps.projectRepo,
    deps.sessionRepo,
    deps.sessionRuntime
  );
  const dashboardStatsService = new GetDashboardStatsService(
    dashboardOverviewService
  );
  const observabilitySnapshotService = new GetObservabilitySnapshotService({
    sessionRuntime: deps.sessionRuntime,
    logStore: deps.logStore,
    getCacheStats: deps.getCacheStats,
    getBackgroundRunnerState: deps.getBackgroundRunnerState,
    getAcpTurnIdMigrationSnapshot: getTurnIdMigrationSnapshot,
  });
  const dashboardPageDataService = new GetDashboardPageDataService({
    dashboardOverview: dashboardOverviewService,
    listDashboardSessions: dashboardSessionsService,
    agentRepo: deps.agentRepo,
  });

  return {
    dashboardEventVisibility: dashboardEventVisibilityService,
    observabilitySnapshot: observabilitySnapshotService,
    dashboardProjects: dashboardProjectsService,
    dashboardSessions: dashboardSessionsService,
    dashboardStats: dashboardStatsService,
    dashboardPageData: dashboardPageDataService,
  };
}
