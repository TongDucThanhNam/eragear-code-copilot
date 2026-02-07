import { NotFoundError, ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Project, ProjectUpdateInput } from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class UpdateProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(projectRepo: ProjectRepositoryPort, eventBus: EventBusPort) {
    this.projectRepo = projectRepo;
    this.eventBus = eventBus;
  }

  async execute(input: ProjectUpdateInput) {
    const updated = await this.updateProject(input);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_updated",
      projectId: updated.id,
    });
    return updated;
  }

  private async updateProject(input: ProjectUpdateInput): Promise<Project> {
    try {
      return await this.projectRepo.update(input);
    } catch (error) {
      if (error instanceof Error && error.message === "Project not found") {
        throw new NotFoundError(error.message, {
          module: "project",
          op: "project.lifecycle.update",
          details: { id: input.id },
        });
      }
      throw new ValidationError(
        error instanceof Error ? error.message : "Invalid project update",
        {
          module: "project",
          op: "project.lifecycle.update",
          details: { id: input.id },
        }
      );
    }
  }
}
