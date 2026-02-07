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

  async execute(id: string) {
    const project = await this.projectRepo.findById(id);
    if (!project) {
      throw new NotFoundError("Project not found", {
        module: "project",
        op: OP,
        details: { projectId: id },
      });
    }

    await this.eventBus.publish({
      type: "project_deleting",
      projectId: project.id,
      projectPath: project.path,
    });

    await this.projectRepo.delete(id);

    await this.eventBus.publish({
      type: "project_deleted",
      projectId: project.id,
      projectPath: project.path,
    });
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_deleted",
      projectId: project.id,
    });

    return { ok: true };
  }
}
