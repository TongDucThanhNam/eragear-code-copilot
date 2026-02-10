import { NotFoundError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

const OP = "project.lifecycle.delete";

export class DeleteProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(projectRepo: ProjectRepositoryPort, eventBus: EventBusPort) {
    this.projectRepo = projectRepo;
    this.eventBus = eventBus;
  }

  async execute(userId: string, id: string) {
    const project = await this.projectRepo.findById(id, userId);
    if (!project) {
      throw new NotFoundError("Project not found", {
        module: "project",
        op: OP,
        details: { projectId: id },
      });
    }
    const activeProjectId = await this.projectRepo.getActiveId(userId);
    if (activeProjectId === id) {
      await this.projectRepo.setActive(null, userId);
    }

    await this.eventBus.publish({
      type: "project_deleting",
      userId,
      projectId: project.id,
      projectPath: project.path,
    });

    await this.projectRepo.delete(id, userId);

    await this.eventBus.publish({
      type: "project_deleted",
      userId,
      projectId: project.id,
      projectPath: project.path,
    });
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_deleted",
      userId,
      projectId: project.id,
    });

    return { ok: true };
  }
}
