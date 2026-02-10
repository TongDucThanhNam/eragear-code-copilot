import { NotFoundError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class SetActiveProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(projectRepo: ProjectRepositoryPort, eventBus: EventBusPort) {
    this.projectRepo = projectRepo;
    this.eventBus = eventBus;
  }

  async execute(userId: string, id: string | null) {
    try {
      await this.projectRepo.setActive(id, userId);
    } catch (error) {
      if (error instanceof Error && error.message === "Project not found") {
        throw new NotFoundError(error.message, {
          module: "project",
          op: "project.lifecycle.set_active",
          details: { id },
        });
      }
      throw error;
    }
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_set_active",
      userId,
      projectId: id ?? undefined,
    });
    return { activeProjectId: id };
  }
}
