import type { ProjectRepositoryPort } from "./ports/project-repository.port";

/**
 * Reads the user's project list together with active project state.
 *
 * Side effect: repairs dangling active-project state to `null`. Project list
 * reads do not auto-select a fallback project.
 */
export class ListProjectsService {
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  async execute(userId: string) {
    return await this.projectRepo.listWithActiveState(userId);
  }
}
