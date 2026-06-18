import { describe, expect, test } from "bun:test";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";
import { GetDashboardPageDataService } from "./get-dashboard-page-data.service";
import type { ListDashboardSessionsService } from "./list-dashboard-sessions.service";

describe("GetDashboardPageDataService", () => {
  test("uses dashboard overview once for initial page projects and stats", async () => {
    const overviewCalls: string[] = [];
    const projects = [{ id: "project-1", sessionCount: 2 }];
    const dashboardOverview = {
      execute(userId: string) {
        overviewCalls.push(userId);
        return Promise.resolve({
          projects,
          stats: { totalProjects: 1, totalSessions: 2 },
        });
      },
    } as unknown as GetDashboardOverviewService;
    const sessionCalls: unknown[] = [];
    const listDashboardSessions = {
      execute(input: unknown) {
        sessionCalls.push(input);
        return Promise.resolve({
          sessions: [{ id: "chat-1" }],
        });
      },
    } as unknown as ListDashboardSessionsService;
    const agentRepo = {
      findAll: async (userId: string) => [{ id: "agent-1", userId }],
    } as unknown as AgentRepositoryPort;
    const service = new GetDashboardPageDataService({
      dashboardOverview,
      listDashboardSessions,
      agentRepo,
    });

    const result = await service.execute({
      userId: "user-1",
      limit: 10,
      offset: 5,
    });

    expect(overviewCalls).toEqual(["user-1"]);
    expect(sessionCalls).toEqual([
      {
        userId: "user-1",
        limit: 10,
        offset: 5,
        projects,
      },
    ]);
    expect(result).toMatchObject({
      stats: { totalProjects: 1, totalSessions: 2 },
      projects: [{ id: "project-1", sessionCount: 2 }],
      sessions: [{ id: "chat-1" }],
      agents: [{ id: "agent-1", userId: "user-1" }],
    });
  });
});
