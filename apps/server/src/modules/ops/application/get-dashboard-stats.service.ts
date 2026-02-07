import type { ProjectRepositoryPort } from "@/modules/project";
import type { SessionRepositoryPort } from "@/modules/session";
import { forEachSessionPage } from "./iterate-session-pages.util";

export class GetDashboardStatsService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(
    projectRepo: ProjectRepositoryPort,
    sessionRepo: SessionRepositoryPort
  ) {
    this.projectRepo = projectRepo;
    this.sessionRepo = sessionRepo;
  }

  async execute() {
    const projects = await this.projectRepo.findAll();
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const agentStats: Record<string, { count: number; running: number }> = {};
    let totalSessions = 0;
    let activeSessions = 0;
    let recentSessions24h = 0;
    let weeklySessions = 0;

    await forEachSessionPage(this.sessionRepo, (sessions) => {
      for (const session of sessions) {
        totalSessions += 1;
        if (session.status === "running") {
          activeSessions += 1;
        }
        if (session.lastActiveAt > oneDayAgo) {
          recentSessions24h += 1;
        }
        if (session.lastActiveAt > oneWeekAgo) {
          weeklySessions += 1;
        }

        const agentName =
          session.agentInfo?.title ?? session.agentInfo?.name ?? "Unknown";
        if (!agentStats[agentName]) {
          agentStats[agentName] = { count: 0, running: 0 };
        }
        agentStats[agentName].count += 1;
        if (session.status === "running") {
          agentStats[agentName].running += 1;
        }
      }
    });

    return {
      stats: {
        totalProjects: projects.length,
        totalSessions,
        activeSessions,
        recentSessions24h,
        weeklySessions,
        agentStats,
        serverUptime: process.uptime(),
      },
    };
  }
}
