import type { SessionRepositoryPort } from "#runtime/modules/session";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { StoredSession } from "#runtime/shared/types/session.types";
import {
  DashboardProjectContext,
  type DashboardProjectContextProject,
} from "./dashboard-project-context";
import { forEachSessionPage } from "./iterate-session-pages.util";

export type DashboardAggregationProject = DashboardProjectContextProject;

export interface DashboardProjectSessionCounts {
  total: number;
  running: number;
}

export interface DashboardSessionAggregation {
  statsByProjectId: Map<string, DashboardProjectSessionCounts>;
  totalSessions: number;
  activeSessions: number;
  recentSessions24h: number;
  weeklySessions: number;
  agentStats: Record<string, { count: number; running: number }>;
}

/**
 * Builds dashboard-wide session counters through one paged session scan.
 *
 * Caller contract: project association is derived from stored `projectId`
 * first and project-root path fallback second; this read model never backfills
 * session metadata.
 */
export class DashboardSessionAggregationService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly clock: ClockPort;

  constructor(sessionRepo: SessionRepositoryPort, clock: ClockPort) {
    this.sessionRepo = sessionRepo;
    this.clock = clock;
  }

  async execute(input: {
    userId: string;
    projects: DashboardAggregationProject[];
  }): Promise<DashboardSessionAggregation> {
    const now = this.clock.nowMs();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const projectContext = new DashboardProjectContext(input.projects);
    const statsByProjectId = new Map<string, DashboardProjectSessionCounts>(
      projectContext
        .projectIds()
        .map((projectId) => [projectId, { total: 0, running: 0 }])
    );
    const agentStats: Record<string, { count: number; running: number }> = {};
    let totalSessions = 0;
    let activeSessions = 0;
    let recentSessions24h = 0;
    let weeklySessions = 0;

    await forEachSessionPage(this.sessionRepo, input.userId, (sessions) => {
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

        this.recordProjectSession(session, projectContext, statsByProjectId);
      }
    });

    return {
      statsByProjectId,
      totalSessions,
      activeSessions,
      recentSessions24h,
      weeklySessions,
      agentStats,
    };
  }

  private recordProjectSession(
    session: StoredSession,
    projectContext: DashboardProjectContext,
    statsByProjectId: Map<string, DashboardProjectSessionCounts>
  ): void {
    const resolvedProject = projectContext.resolveSessionProject(session);
    if (!resolvedProject) {
      return;
    }

    const stat = statsByProjectId.get(resolvedProject.id);
    if (!stat) {
      return;
    }

    stat.total += 1;
    if (session.status === "running") {
      stat.running += 1;
    }
  }
}
