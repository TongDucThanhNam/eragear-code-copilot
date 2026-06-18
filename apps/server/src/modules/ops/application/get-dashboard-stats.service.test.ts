import { describe, expect, test } from "bun:test";
import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";
import { GetDashboardStatsService } from "./get-dashboard-stats.service";

describe("GetDashboardStatsService", () => {
  test("returns stats from the dashboard overview read model", async () => {
    const overviewCalls: string[] = [];
    const dashboardOverview = {
      execute(userId: string) {
        overviewCalls.push(userId);
        return Promise.resolve({
          projects: [],
          stats: {
            totalProjects: 2,
            totalSessions: 5,
            activeSessions: 2,
            recentSessions24h: 3,
            weeklySessions: 4,
            agentStats: {
              Codex: { count: 5, running: 2 },
            },
            serverUptime: 12,
          },
        });
      },
    } as unknown as GetDashboardOverviewService;
    const service = new GetDashboardStatsService(dashboardOverview);

    const result = await service.execute("user-1");

    expect(overviewCalls).toEqual(["user-1"]);
    expect(result.stats).toEqual({
      totalProjects: 2,
      totalSessions: 5,
      activeSessions: 2,
      recentSessions24h: 3,
      weeklySessions: 4,
      agentStats: {
        Codex: { count: 5, running: 2 },
      },
      serverUptime: 12,
    });
  });
});
