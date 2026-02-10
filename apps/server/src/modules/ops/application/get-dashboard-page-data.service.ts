import { DEFAULT_SESSION_LIST_PAGE_LIMIT } from "@/config/constants";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { GetDashboardStatsService } from "./get-dashboard-stats.service";
import type { ListDashboardProjectsService } from "./list-dashboard-projects.service";
import type { ListDashboardSessionsService } from "./list-dashboard-sessions.service";

export class GetDashboardPageDataService {
  private readonly listDashboardProjects: ListDashboardProjectsService;
  private readonly listDashboardSessions: ListDashboardSessionsService;
  private readonly getDashboardStats: GetDashboardStatsService;
  private readonly agentRepo: AgentRepositoryPort;

  constructor(params: {
    listDashboardProjects: ListDashboardProjectsService;
    listDashboardSessions: ListDashboardSessionsService;
    getDashboardStats: GetDashboardStatsService;
    agentRepo: AgentRepositoryPort;
  }) {
    this.listDashboardProjects = params.listDashboardProjects;
    this.listDashboardSessions = params.listDashboardSessions;
    this.getDashboardStats = params.getDashboardStats;
    this.agentRepo = params.agentRepo;
  }

  async execute(input: { userId: string; limit?: number; offset?: number }) {
    const limit = input?.limit ?? DEFAULT_SESSION_LIST_PAGE_LIMIT;
    const offset = input?.offset ?? 0;

    const [projectsResult, sessionsResult, statsResult, agents] =
      await Promise.all([
        this.listDashboardProjects.execute(input.userId),
        this.listDashboardSessions.execute({
          userId: input.userId,
          limit,
          offset,
        }),
        this.getDashboardStats.execute(input.userId),
        this.agentRepo.findAll(input.userId),
      ]);

    return {
      stats: statsResult.stats,
      projects: projectsResult.projects,
      sessions: sessionsResult.sessions,
      agents,
    };
  }
}
