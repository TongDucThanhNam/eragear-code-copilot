import { NotFoundError } from "@/shared/errors";
import type { Project } from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

const MODULE = "project";
const OP_RESOLVE_ACTIVE = "project.resolve-active";

export interface ResolveActiveProjectErrorContext {
  module?: string;
  op?: string;
}

/**
 * Resolves the user's active project into the full project row.
 *
 * Error mode: callers receive a typed `NotFoundError` when no active project is
 * selected or when persisted active state points at a missing project.
 */
export class ResolveActiveProjectService {
  private readonly projectRepo: ProjectRepositoryPort;

  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  async execute(
    userId: string,
    context: ResolveActiveProjectErrorContext = {}
  ): Promise<Project> {
    const errorContext = {
      module: context.module ?? MODULE,
      op: context.op ?? OP_RESOLVE_ACTIVE,
    };

    const activeProjectId = await this.projectRepo.getActiveId(userId);
    if (!activeProjectId) {
      throw new NotFoundError("No active project selected", errorContext);
    }

    const project = await this.projectRepo.findById(activeProjectId, userId);
    if (!project) {
      throw new NotFoundError("Active project not found", {
        ...errorContext,
        details: { projectId: activeProjectId },
      });
    }

    return project;
  }
}
