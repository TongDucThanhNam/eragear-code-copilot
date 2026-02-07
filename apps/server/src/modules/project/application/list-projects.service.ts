import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class ListProjectsService {
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  async execute() {
    return {
      projects: await this.projectRepo.findAll(),
      activeProjectId: await this.projectRepo.getActiveId(),
    };
  }
}
