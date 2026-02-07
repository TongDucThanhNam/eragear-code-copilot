import type { ProjectRepositoryPort } from "@/modules/project";
import type { SessionRepositoryPort } from "@/modules/session";
import type { Project } from "@/shared/types/project.types";
import { forEachSessionPage } from "./iterate-session-pages.util";

export class ListDashboardProjectsService {
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
    const projectPathMap = new Map(
      projects.map((project) => [project.path, project.id] as const)
    );
    const statsByProjectId = new Map<
      string,
      { total: number; running: number }
    >(projects.map((project) => [project.id, { total: 0, running: 0 }]));

    await forEachSessionPage(this.sessionRepo, (sessions) => {
      for (const session of sessions) {
        const resolvedProjectId =
          session.projectId ?? projectPathMap.get(session.projectRoot);
        if (!resolvedProjectId) {
          continue;
        }

        const stat = statsByProjectId.get(resolvedProjectId);
        if (!stat) {
          continue;
        }

        stat.total += 1;
        if (session.status === "running") {
          stat.running += 1;
        }
      }
    });

    const projectsWithStats = projects.map((project: Project) => {
      const stat = statsByProjectId.get(project.id) ?? {
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

    return { projects: projectsWithStats };
  }
}
