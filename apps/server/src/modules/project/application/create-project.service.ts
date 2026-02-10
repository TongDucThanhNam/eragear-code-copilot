import type { SettingsRepositoryPort } from "@/modules/settings";
import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Project, ProjectInput } from "@/shared/types/project.types";
import { resolveProjectPath } from "@/shared/utils/project-roots.util";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class CreateProjectService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(
    projectRepo: ProjectRepositoryPort,
    settingsRepo: SettingsRepositoryPort,
    eventBus: EventBusPort
  ) {
    this.projectRepo = projectRepo;
    this.settingsRepo = settingsRepo;
    this.eventBus = eventBus;
  }

  async execute(userId: string, input: Omit<ProjectInput, "userId">) {
    const project = await this.createProject(userId, input);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_created",
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
