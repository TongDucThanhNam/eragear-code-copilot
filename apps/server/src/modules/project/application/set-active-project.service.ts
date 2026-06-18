import { NotFoundError } from "@/shared/errors";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import type { ProjectLifecycleNotifier } from "./project-lifecycle.notifier";

/**
 * Sets or clears the active project for a user.
 *
 * Error mode: repository "Project not found" errors are mapped to
 * `NotFoundError`; successful changes report an active-project notification.
 */
export class SetActiveProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly projectLifecycleNotifier: ProjectLifecycleNotifier;

  constructor(
    projectRepo: ProjectRepositoryPort,
    projectLifecycleNotifier: ProjectLifecycleNotifier
  ) {
    this.projectRepo = projectRepo;
    this.projectLifecycleNotifier = projectLifecycleNotifier;
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
    await this.projectLifecycleNotifier.projectSetActive({
      userId,
      projectId: id ?? undefined,
    });
    return { activeProjectId: id };
  }
}
