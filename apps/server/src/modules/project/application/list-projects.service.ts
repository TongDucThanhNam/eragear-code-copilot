import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class ListProjectsService {
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  async execute(userId: string) {
    return {
      projects: await this.projectRepo.findAll(userId),
      activeProjectId: await this.projectRepo.getActiveId(userId),
    };
  }
}
