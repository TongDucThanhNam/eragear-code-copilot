import type { ProjectRepositoryPort } from "./ports/project-repository.port";

/**
 * Reads the user's project list together with active project state.
 *
 * Caller contract: this is a pure read use-case; it does not repair or create
 * missing projects/active IDs.
 */
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
