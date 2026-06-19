import { describe, expect, test } from "bun:test";
import type { GetDashboardOverviewService } from "./get-dashboard-overview.service";
import { ListDashboardProjectsService } from "./list-dashboard-projects.service";

describe("ListDashboardProjectsService", () => {
  test("returns projects from the dashboard overview read model", async () => {
    const overviewCalls: string[] = [];
    const dashboardOverview = {
      execute(userId: string) {
        overviewCalls.push(userId);
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              sessionCount: 3,
              runningCount: 1,
            },
          ],
          stats: { totalProjects: 1 },
        });
      },
    } as unknown as GetDashboardOverviewService;
    const service = new ListDashboardProjectsService(dashboardOverview);

    const result = await service.execute("user-1");

    expect(overviewCalls).toEqual(["user-1"]);
    expect(result.projects).toMatchObject([
      {
        id: "project-1",
        sessionCount: 3,
        runningCount: 1,
      },
    ]);
  });
});
