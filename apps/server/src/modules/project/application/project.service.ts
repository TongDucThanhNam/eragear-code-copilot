import type { ProjectRepositoryPort } from "../../../shared/types/ports";
import type {
  ProjectInput,
  ProjectUpdateInput,
} from "../../../shared/types/project.types";

export class ProjectService {
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  listProjects() {
    return {
      projects: this.projectRepo.findAll(),
      activeProjectId: this.projectRepo.getActiveId(),
    };
  }

  createProject(input: ProjectInput) {
    return this.projectRepo.create(input);
  }

  updateProject(input: ProjectUpdateInput) {
    return this.projectRepo.update(input);
  }

  deleteProject(id: string) {
    this.projectRepo.delete(id);
    return { ok: true };
  }

  setActiveProject(id: string | null) {
    return this.projectRepo.setActive(id);
  }
}
