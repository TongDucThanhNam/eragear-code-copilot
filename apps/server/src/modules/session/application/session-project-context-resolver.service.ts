import type { ProjectRepositoryPort } from "@/modules/project";
import type { SettingsRepositoryPort } from "@/modules/settings";
import { NotFoundError, ValidationError } from "@/shared/errors";

const OP = "session.lifecycle.create";

export interface SessionProjectContextInput {
  userId: string;
  projectId?: string;
  projectRoot?: string;
}

export interface SessionProjectContext {
  projectId?: string;
  projectRoot: string;
}

export class SessionProjectContextResolverService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly settingsRepo: SettingsRepositoryPort;

  constructor(
    projectRepo: ProjectRepositoryPort,
    settingsRepo: SettingsRepositoryPort
  ) {
    this.projectRepo = projectRepo;
    this.settingsRepo = settingsRepo;
  }

  async resolve(
    params: SessionProjectContextInput
  ): Promise<SessionProjectContext> {
    if (params.projectId) {
      const project = await this.projectRepo.findById(
        params.projectId,
        params.userId
      );
      if (!project) {
        throw new NotFoundError("Project not found", {
          module: "session",
          op: OP,
          details: { projectId: params.projectId },
        });
      }
      return {
        projectId: project.id,
        projectRoot: project.path,
      };
    }

    if (!params.projectRoot) {
      throw new ValidationError(
        "projectRoot is required when projectId is not provided",
        {
          module: "session",
          op: OP,
        }
      );
    }

    const { projectRoots } = await this.settingsRepo.get();
    if (!projectRoots || projectRoots.length === 0) {
      return { projectRoot: params.projectRoot };
    }
    return { projectRoot: params.projectRoot };
  }
}
