import { NotFoundError } from "#runtime/shared/errors";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import type { ProjectLifecycleNotifier } from "./project-lifecycle.notifier";

const OP = "project.lifecycle.delete";

/**
 * Deletes a user-owned project and announces cleanup lifecycle events.
 *
 * Ordering contract: `project_deleting` is published before the repository row
 * is removed so module-owned subscribers can clean related state while project
 * metadata is still available.
 */
export class DeleteProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly projectLifecycleNotifier: ProjectLifecycleNotifier;

  constructor(
    projectRepo: ProjectRepositoryPort,
    projectLifecycleNotifier: ProjectLifecycleNotifier
  ) {
    this.projectRepo = projectRepo;
    this.projectLifecycleNotifier = projectLifecycleNotifier;
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

    await this.projectLifecycleNotifier.beforeProjectDelete({
      userId,
      projectId: project.id,
      projectPath: project.path,
    });

    await this.projectRepo.deleteAndClearActive(id, userId);

    await this.projectLifecycleNotifier.afterProjectDeleted({
      userId,
      projectId: project.id,
      projectPath: project.path,
    });

    return { ok: true };
  }
}
