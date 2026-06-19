import { DEFAULT_SESSION_LIST_PAGE_LIMIT } from "#runtime/config/constants";
import type { AgentRepositoryPort } from "#runtime/modules/agent";
import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";
import type { ListDashboardSessionsService } from "./list-dashboard-sessions.service";

/**
 * Aggregates the initial dashboard page read model.
 *
 * Ordering contract: project/stats overview is the source of dashboard project
 * context; session list enrichment reuses that context instead of re-reading
 * projects.
 */
export class GetDashboardPageDataService {
  private readonly dashboardOverview: GetDashboardOverviewService;
  private readonly listDashboardSessions: ListDashboardSessionsService;
  private readonly agentRepo: AgentRepositoryPort;

  constructor(params: {
    dashboardOverview: GetDashboardOverviewService;
    listDashboardSessions: ListDashboardSessionsService;
    agentRepo: AgentRepositoryPort;
  }) {
    this.dashboardOverview = params.dashboardOverview;
    this.listDashboardSessions = params.listDashboardSessions;
    this.agentRepo = params.agentRepo;
  }

  async execute(input: { userId: string; limit?: number; offset?: number }) {
    const limit = input?.limit ?? DEFAULT_SESSION_LIST_PAGE_LIMIT;
    const offset = input?.offset ?? 0;

    const [overview, agents] = await Promise.all([
      this.dashboardOverview.execute(input.userId),
      this.agentRepo.findAll(input.userId),
    ]);
    const sessionsResult = await this.listDashboardSessions.execute({
      userId: input.userId,
      limit,
      offset,
      projects: overview.projects,
    });

    return {
      stats: overview.stats,
      projects: overview.projects,
      sessions: sessionsResult.sessions,
      agents,
    };
  }
}
