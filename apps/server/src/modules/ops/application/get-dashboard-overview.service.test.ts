import { describe, expect, test } from "bun:test";
import type { ProjectRepositoryPort } from "@/modules/project";
import type { Project } from "@/shared/types/project.types";
import type { DashboardSessionAggregationService } from "./dashboard-session-aggregation.service";
import { GetDashboardOverviewService } from "./get-dashboard-overview.service";

function createProject(
  overrides: Partial<Project> & Pick<Project, "id">
): Project {
  return {
    id: overrides.id,
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "Project",
    path: overrides.path ?? `/repo/${overrides.id}`,
    description: overrides.description ?? null,
    tags: overrides.tags ?? [],
    obsidianProjectPath: overrides.obsidianProjectPath ?? null,
    techStackTags: overrides.techStackTags ?? [],
    favorite: overrides.favorite ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    lastOpenedAt: overrides.lastOpenedAt ?? null,
  };
}

describe("GetDashboardOverviewService", () => {
  test("builds projects and stats from one project read and one aggregation read", async () => {
    const projectOne = createProject({ id: "project-1", lastOpenedAt: 123 });
    const projectTwo = createProject({ id: "project-2" });
    const projects = [projectOne, projectTwo];
    const projectRepo = {
      findAll: async () => projects,
    } as unknown as ProjectRepositoryPort;
    const aggregationCalls: unknown[] = [];
    const sessionAggregation = {
      execute(input: unknown) {
        aggregationCalls.push(input);
        return Promise.resolve({
          statsByProjectId: new Map([["project-1", { total: 3, running: 1 }]]),
          totalSessions: 5,
          activeSessions: 2,
          recentSessions24h: 3,
          weeklySessions: 4,
          agentStats: {
            Codex: { count: 5, running: 2 },
          },
        });
      },
    } as unknown as DashboardSessionAggregationService;
    const service = new GetDashboardOverviewService(
      projectRepo,
      sessionAggregation
    );

    const result = await service.execute("user-1");

    expect(aggregationCalls).toEqual([
      {
        userId: "user-1",
        projects,
      },
    ]);
    expect(result.projects).toEqual([
      {
        ...projectOne,
        sessionCount: 3,
        runningCount: 1,
        lastOpenedAt: 123,
      },
      {
        ...projectTwo,
        sessionCount: 0,
        runningCount: 0,
        lastOpenedAt: null,
      },
    ]);
    expect(result.stats).toMatchObject({
      totalProjects: 2,
      totalSessions: 5,
      activeSessions: 2,
      recentSessions24h: 3,
      weeklySessions: 4,
      agentStats: {
        Codex: { count: 5, running: 2 },
      },
    });
    expect(typeof result.stats.serverUptime).toBe("number");
  });
});
