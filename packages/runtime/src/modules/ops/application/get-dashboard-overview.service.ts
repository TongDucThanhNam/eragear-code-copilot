import type { ProjectRepositoryPort } from "#runtime/modules/project";
import type { Project } from "#runtime/shared/types/project.types";
import type {
  DashboardSessionAggregation,
  DashboardSessionAggregationService,
} from "./dashboard-session-aggregation.service";

export interface DashboardProjectSummary extends Project {
  sessionCount: number;
  runningCount: number;
}

export interface DashboardStatsSummary {
  totalProjects: number;
  totalSessions: number;
  activeSessions: number;
  recentSessions24h: number;
  weeklySessions: number;
  agentStats: Record<string, { count: number; running: number }>;
  serverUptime: number;
}

export interface DashboardOverview {
  projects: DashboardProjectSummary[];
  stats: DashboardStatsSummary;
}

/**
 * Builds the shared dashboard project/stats overview read model.
 *
 * Invariant: project rows are read once and passed to session aggregation so
 * initial dashboard page loads do not duplicate project reads or session scans.
 */
export class GetDashboardOverviewService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly sessionAggregation: DashboardSessionAggregationService;

  constructor(
    projectRepo: ProjectRepositoryPort,
    sessionAggregation: DashboardSessionAggregationService
  ) {
    this.projectRepo = projectRepo;
    this.sessionAggregation = sessionAggregation;
  }

  async execute(userId: string): Promise<DashboardOverview> {
    const projects = await this.projectRepo.findAll(userId);
    const aggregation = await this.sessionAggregation.execute({
      userId,
      projects,
    });

    return {
      projects: this.toDashboardProjects(projects, aggregation),
      stats: this.toDashboardStats(projects, aggregation),
    };
  }

  private toDashboardProjects(
    projects: Project[],
    aggregation: DashboardSessionAggregation
  ): DashboardProjectSummary[] {
    return projects.map((project) => {
      const stat = aggregation.statsByProjectId.get(project.id) ?? {
        total: 0,
        running: 0,
      };
      return {
        ...project,
        sessionCount: stat.total,
        runningCount: stat.running,
        lastOpenedAt: project.lastOpenedAt,
      };
    });
  }

  private toDashboardStats(
    projects: Project[],
    aggregation: DashboardSessionAggregation
  ): DashboardStatsSummary {
    return {
      totalProjects: projects.length,
      totalSessions: aggregation.totalSessions,
      activeSessions: aggregation.activeSessions,
      recentSessions24h: aggregation.recentSessions24h,
      weeklySessions: aggregation.weeklySessions,
      agentStats: aggregation.agentStats,
      serverUptime: process.uptime(),
    };
  }
}
