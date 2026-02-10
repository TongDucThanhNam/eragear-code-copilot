import type { SettingsRepositoryPort } from "@/modules/settings";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Project, ProjectUpdateInput } from "@/shared/types/project.types";
import { resolveProjectPath } from "@/shared/utils/project-roots.util";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class UpdateProjectService {
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

  async execute(userId: string, input: Omit<ProjectUpdateInput, "userId">) {
    const updated = await this.updateProject(userId, input);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_updated",
      userId,
      projectId: updated.id,
    });
    return updated;
  }

  private async updateProject(
    userId: string,
    input: Omit<ProjectUpdateInput, "userId">
  ): Promise<Project> {
    const normalizedInput: Omit<ProjectUpdateInput, "userId"> = {
      ...input,
    };

    if (input.name !== undefined) {
      const normalizedName = input.name.trim();
      if (!normalizedName) {
        throw new ValidationError("Project name is required", {
          module: "project",
          op: "project.lifecycle.update",
          details: { id: input.id },
        });
      }
      normalizedInput.name = normalizedName;
    }

    if (input.path !== undefined) {
      const settings = await this.settingsRepo.get();
      const resolvedPath = resolveProjectPath(
        input.path,
        settings.projectRoots
      );
      const existingProject = await this.projectRepo.findByPath(resolvedPath);
      if (existingProject && existingProject.id !== input.id) {
        throw new ValidationError(
          `Project path already exists: ${resolvedPath}`,
          {
            module: "project",
            op: "project.lifecycle.update",
            details: { id: input.id },
          }
        );
      }
      normalizedInput.path = resolvedPath;
    }

    try {
      return await this.projectRepo.update({ ...normalizedInput, userId });
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
