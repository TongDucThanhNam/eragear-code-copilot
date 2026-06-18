import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";

/**
 * Builds aggregate dashboard counters for one user.
 *
 * Invariant: session counts are computed through paged repository iteration so
 * large stores do not require loading every session at once.
 */
export class GetDashboardStatsService {
  private readonly dashboardOverview: GetDashboardOverviewService;

  constructor(dashboardOverview: GetDashboardOverviewService) {
    this.dashboardOverview = dashboardOverview;
  }

  async execute(userId: string) {
    const overview = await this.dashboardOverview.execute(userId);
    return { stats: overview.stats };
  }
}
