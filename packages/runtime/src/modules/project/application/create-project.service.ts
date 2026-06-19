import type { SettingsRepositoryPort } from "#runtime/modules/settings";
import { ValidationError } from "#runtime/shared/errors";
import type {
  Project,
  ProjectInput,
} from "#runtime/shared/types/project.types";
import { resolveProjectPath } from "#runtime/shared/utils/project-roots.util";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import type { ProjectLifecycleNotifier } from "./project-lifecycle.notifier";

/**
 * Creates a user-owned project after resolving it against configured roots.
 *
 * Error mode: empty names and duplicate resolved paths throw `ValidationError`;
 * successful creation reports a project-created lifecycle notification.
 */
export class CreateProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly projectLifecycleNotifier: ProjectLifecycleNotifier;

  constructor(
    projectRepo: ProjectRepositoryPort,
    settingsRepo: SettingsRepositoryPort,
    projectLifecycleNotifier: ProjectLifecycleNotifier
  ) {
    this.projectRepo = projectRepo;
    this.settingsRepo = settingsRepo;
    this.projectLifecycleNotifier = projectLifecycleNotifier;
  }

  async execute(userId: string, input: Omit<ProjectInput, "userId">) {
    const project = await this.createProject(userId, input);
    await this.projectLifecycleNotifier.projectCreated({
      userId,
      projectId: project.id,
    });
    return project;
  }

  private async createProject(
    userId: string,
    input: Omit<ProjectInput, "userId">
  ): Promise<Project> {
    const normalizedName = input.name.trim();
    if (!normalizedName) {
      throw new ValidationError("Project name is required", {
        module: "project",
        op: "project.lifecycle.create",
      });
    }

    const settings = await this.settingsRepo.get();
    const resolvedPath = resolveProjectPath(input.path, settings.projectRoots);
    const existingProject = await this.projectRepo.findByPath(resolvedPath);
    if (existingProject) {
      throw new ValidationError(
        `Project path already exists: ${resolvedPath}`,
        {
          module: "project",
          op: "project.lifecycle.create",
        }
      );
    }

    try {
      return await this.projectRepo.create({
        ...input,
        userId,
        name: normalizedName,
        path: resolvedPath,
      });
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
