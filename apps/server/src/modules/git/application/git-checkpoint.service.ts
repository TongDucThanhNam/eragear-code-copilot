import path from "node:path";
import type {
  ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "@/modules/project";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type {
  GitCheckpointCreateInput,
  GitCheckpointListInput,
  GitCheckpointListResult,
  GitCheckpointRestoreInput,
  GitCheckpointRestoreResult,
} from "./contracts/git.contract";
import type { GitCheckpointPort } from "./ports/git-checkpoint.port";

const MODULE = "git";
const OP_RESOLVE_PROJECT = "git.checkpoint.resolve-project";
const OP_CREATE_CHECKPOINT = "git.checkpoint.create";
const OP_LIST_CHECKPOINTS = "git.checkpoint.list";

export interface CreateAutomaticGitCheckpointInput {
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId?: string;
  agentSessionId?: string;
  turnId?: string;
}

export class GitCheckpointService {
  private readonly checkpoints: GitCheckpointPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly activeProjectResolver: ResolveActiveProjectService;
  private readonly clock: ClockPort;

  constructor(
    checkpoints: GitCheckpointPort,
    projectRepo: ProjectRepositoryPort,
    activeProjectResolver: ResolveActiveProjectService,
    clock: ClockPort
  ) {
    this.checkpoints = checkpoints;
    this.projectRepo = projectRepo;
    this.activeProjectResolver = activeProjectResolver;
    this.clock = clock;
  }

  async createCheckpoint(
    userId: string,
    input?: GitCheckpointCreateInput
  ): Promise<GitCheckpointListResult> {
    const project = await this.resolveProject(userId, input?.projectId);
    await this.checkpoints.createCheckpoint({
      projectRoot: project.path,
      projectId: project.id,
      projectName: project.name,
      kind: "manual",
      ...(input?.name ? { name: input.name } : {}),
    });
    return await this.listCheckpoints(userId, { projectId: project.id });
  }

  async listCheckpoints(
    userId: string,
    input?: GitCheckpointListInput
  ): Promise<GitCheckpointListResult> {
    const project = await this.resolveProject(userId, input?.projectId);
    const checkpoints = await this.checkpoints.listCheckpoints({
      projectRoot: project.path,
      ...(input?.limit ? { limit: input.limit } : {}),
    });
    return {
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
      checkpoints,
      checkedAt: new Date(this.clock.nowMs()).toISOString(),
    };
  }

  async restoreCheckpoint(
    userId: string,
    input: GitCheckpointRestoreInput
  ): Promise<GitCheckpointRestoreResult> {
    const project = await this.resolveProject(userId, input.projectId);
    const restored = await this.checkpoints.restoreCheckpoint({
      projectRoot: project.path,
      checkpointId: input.checkpointId,
    });
    return {
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
      checkpoint: restored.checkpoint,
      ...(restored.safetyCheckpoint
        ? { safetyCheckpoint: restored.safetyCheckpoint }
        : {}),
      restoredAt: restored.restoredAt,
    };
  }

  async createAutomaticCheckpoint(
    input: CreateAutomaticGitCheckpointInput
  ): Promise<void> {
    const project = await this.resolveLifecycleProject(input);
    await this.checkpoints.createCheckpoint({
      projectRoot: project.path,
      projectId: project.id,
      projectName: project.name,
      kind: "auto",
      name: input.turnId
        ? `Agent turn ${input.turnId}`
        : "Agent turn checkpoint",
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
    });
  }

  private async resolveProject(userId: string, projectId?: string) {
    const requestedProjectId = projectId?.trim();
    if (requestedProjectId) {
      const project = await this.projectRepo.findById(
        requestedProjectId,
        userId
      );
      if (!project) {
        throw new NotFoundError("Project not found", {
          module: MODULE,
          op: OP_RESOLVE_PROJECT,
          details: { projectId: requestedProjectId },
        });
      }
      return project;
    }

    return await this.activeProjectResolver.execute(userId, {
      module: MODULE,
      op: OP_LIST_CHECKPOINTS,
    });
  }

  private async resolveLifecycleProject(
    input: CreateAutomaticGitCheckpointInput
  ) {
    const projectRoot = input.projectRoot.trim();
    if (!projectRoot) {
      throw new ValidationError("Project root is required", {
        module: MODULE,
        op: OP_CREATE_CHECKPOINT,
      });
    }

    if (input.projectId) {
      const project = await this.projectRepo.findById(
        input.projectId,
        input.userId
      );
      if (!project) {
        throw new NotFoundError("Project not found for checkpoint event", {
          module: MODULE,
          op: OP_RESOLVE_PROJECT,
          details: { projectId: input.projectId },
        });
      }
      this.assertSameProjectRoot(project.path, projectRoot);
      return project;
    }

    const project = await this.projectRepo.findByPath(projectRoot);
    if (!project || project.userId !== input.userId) {
      throw new NotFoundError("Project not found for checkpoint event", {
        module: MODULE,
        op: OP_RESOLVE_PROJECT,
        details: { projectRoot },
      });
    }
    return project;
  }

  private assertSameProjectRoot(projectPath: string, eventProjectRoot: string) {
    if (path.resolve(projectPath) === path.resolve(eventProjectRoot)) {
      return;
    }
    throw new ValidationError("Checkpoint event project root mismatch", {
      module: MODULE,
      op: OP_CREATE_CHECKPOINT,
      details: {
        projectPath,
        eventProjectRoot,
      },
    });
  }
}
