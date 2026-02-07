import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Project, ProjectInput } from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class CreateProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(projectRepo: ProjectRepositoryPort, eventBus: EventBusPort) {
    this.projectRepo = projectRepo;
    this.eventBus = eventBus;
  }

  async execute(input: ProjectInput) {
    const project = await this.createProject(input);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_created",
      projectId: project.id,
    });
    return project;
  }

  private async createProject(input: ProjectInput): Promise<Project> {
    try {
      return await this.projectRepo.create(input);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : "Invalid project input",
        {
          module: "project",
          op: "project.lifecycle.create",
        }
      );
    }
  }
}
