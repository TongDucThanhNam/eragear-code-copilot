import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";

/**
 * Builds the dashboard project list with derived session counts.
 *
 * Caller contract: project/session association is derived from stored
 * `projectId` first and project-root path fallback second; this read does not
 * backfill missing session metadata.
 */
export class ListDashboardProjectsService {
  private readonly dashboardOverview: GetDashboardOverviewService;

  constructor(dashboardOverview: GetDashboardOverviewService) {
    this.dashboardOverview = dashboardOverview;
  }

  async execute(userId: string) {
    const overview = await this.dashboardOverview.execute(userId);
    return { projects: overview.projects };
  }
}
