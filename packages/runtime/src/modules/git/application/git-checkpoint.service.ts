import path from "node:path";
import type {
  ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  GitCheckpointCreateInput,
  GitCheckpointListInput,
  GitCheckpointListResult,
  GitCheckpointRestoreInput,
  GitCheckpointRestoreResult,
  GitTurnCheckpoint,
  GitTurnCheckpointDiffInput,
  GitTurnCheckpointDiffResult,
  GitTurnCheckpointListResult,
  GitTurnCheckpointRevertInput,
  GitTurnCheckpointRevertResult,
  GitTurnCheckpointSessionInput,
} from "./contracts/git.contract";
import type { GitCheckpointPort } from "./ports/git-checkpoint.port";
import type { TurnConversationRollbackPort } from "./ports/turn-conversation-rollback.port";

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

export interface TurnCheckpointLifecycleInput
  extends CreateAutomaticGitCheckpointInput {
  chatId: string;
  turnId: string;
}

export class GitCheckpointService {
  private readonly checkpoints: GitCheckpointPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly activeProjectResolver: ResolveActiveProjectService;
  private readonly clock: ClockPort;
  private readonly conversationRollback?: TurnConversationRollbackPort;

  constructor(
    checkpoints: GitCheckpointPort,
    projectRepo: ProjectRepositoryPort,
    activeProjectResolver: ResolveActiveProjectService,
    clock: ClockPort,
    conversationRollback?: TurnConversationRollbackPort
  ) {
    this.checkpoints = checkpoints;
    this.projectRepo = projectRepo;
    this.activeProjectResolver = activeProjectResolver;
    this.clock = clock;
    this.conversationRollback = conversationRollback;
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

  async captureTurnBaseline(
    input: TurnCheckpointLifecycleInput
  ): Promise<GitTurnCheckpoint> {
    const project = await this.resolveLifecycleProject(input);
    return await this.ensureTurnBaseline({
      projectRoot: project.path,
      sessionId: input.chatId,
      turnId: input.turnId,
    });
  }

  async captureCompletedTurn(
    input: TurnCheckpointLifecycleInput
  ): Promise<GitTurnCheckpointDiffResult> {
    const project = await this.resolveLifecycleProject(input);
    return await this.captureNextTurn({
      projectRoot: project.path,
      sessionId: input.chatId,
      turnId: input.turnId,
    });
  }

  async createTurnCheckpoint(
    userId: string,
    input: GitTurnCheckpointSessionInput & { turnId?: string }
  ): Promise<GitTurnCheckpointDiffResult> {
    const project = await this.resolveSessionProject(userId, input);
    return await this.captureNextTurn({
      projectRoot: project.path,
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
    });
  }

  async listTurnCheckpoints(
    userId: string,
    input: GitTurnCheckpointSessionInput
  ): Promise<GitTurnCheckpointListResult> {
    const project = await this.resolveSessionProject(userId, input);
    return {
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
      checkpoints: await this.checkpoints.listTurnCheckpoints({
        projectRoot: project.path,
        sessionId: input.sessionId,
      }),
      checkedAt: new Date(this.clock.nowMs()).toISOString(),
    };
  }

  async diffTurnCheckpoints(
    userId: string,
    input: GitTurnCheckpointDiffInput
  ): Promise<GitTurnCheckpointDiffResult> {
    const project = await this.resolveSessionProject(userId, input);
    const checkpoints = await this.checkpoints.listTurnCheckpoints({
      projectRoot: project.path,
      sessionId: input.sessionId,
    });
    const from = requireTurnCheckpoint(checkpoints, input.fromTurnCount);
    const to = requireTurnCheckpoint(checkpoints, input.toTurnCount);
    return {
      from,
      to,
      files: await this.checkpoints.diffTurnCheckpoints({
        projectRoot: project.path,
        fromRef: from.ref,
        toRef: to.ref,
      }),
    };
  }

  async revertTurnCheckpoint(
    userId: string,
    input: GitTurnCheckpointRevertInput
  ): Promise<GitTurnCheckpointRevertResult> {
    if (!this.conversationRollback) {
      throw new ValidationError("Conversation rollback is unavailable", {
        module: MODULE,
        op: "git.turn-checkpoint.revert",
      });
    }
    const project = await this.resolveSessionProject(userId, input);
    const checkpoints = await this.checkpoints.listTurnCheckpoints({
      projectRoot: project.path,
      sessionId: input.sessionId,
    });
    const checkpoint = requireTurnCheckpoint(checkpoints, input.turnCount);
    const currentTurnCount = checkpoints.reduce(
      (maximum, item) => Math.max(maximum, item.turnCount),
      0
    );
    if (input.turnCount > currentTurnCount) {
      throw new ValidationError("Turn checkpoint exceeds current turn count", {
        module: MODULE,
        op: "git.turn-checkpoint.revert",
        details: { turnCount: input.turnCount, currentTurnCount },
      });
    }
    const restored = await this.checkpoints.restoreTurnCheckpoint({
      projectRoot: project.path,
      targetRef: checkpoint.ref,
      fallbackToHead: input.turnCount === 0,
    });
    const rollback = await this.conversationRollback.execute({
      userId,
      sessionId: input.sessionId,
      projectRoot: project.path,
      turnCount: input.turnCount,
    });
    const stale = await this.checkpoints.deleteTurnCheckpointsAfter({
      projectRoot: project.path,
      sessionId: input.sessionId,
      turnCount: input.turnCount,
    });
    return {
      checkpoint,
      safetyRef: restored.safetyRef,
      deletedRefs: stale.deletedRefs,
      rolledBackTurns: currentTurnCount - input.turnCount,
      replayedMessages: rollback.replayedMessages,
    };
  }

  private async ensureTurnBaseline(input: {
    projectRoot: string;
    sessionId: string;
    turnId?: string;
  }): Promise<GitTurnCheckpoint> {
    const checkpoints = await this.checkpoints.listTurnCheckpoints({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
    });
    const current = checkpoints.at(-1);
    if (current) {
      return current;
    }
    return await this.checkpoints.captureTurnCheckpoint({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      turnCount: 0,
      kind: "baseline",
    });
  }

  private async captureNextTurn(input: {
    projectRoot: string;
    sessionId: string;
    turnId?: string;
  }): Promise<GitTurnCheckpointDiffResult> {
    let checkpoints = await this.checkpoints.listTurnCheckpoints({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
    });
    const duplicate = input.turnId
      ? checkpoints.find(
          (checkpoint) =>
            checkpoint.kind === "turn" && checkpoint.turnId === input.turnId
        )
      : undefined;
    if (duplicate) {
      const from = requireTurnCheckpoint(
        checkpoints,
        Math.max(0, duplicate.turnCount - 1)
      );
      return {
        from,
        to: duplicate,
        files: await this.checkpoints.diffTurnCheckpoints({
          projectRoot: input.projectRoot,
          fromRef: from.ref,
          toRef: duplicate.ref,
        }),
      };
    }
    const baseline = await this.ensureTurnBaseline(input);
    checkpoints = await this.checkpoints.listTurnCheckpoints({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
    });
    const from = checkpoints.at(-1) ?? baseline;
    const to = await this.checkpoints.captureTurnCheckpoint({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      turnCount: from.turnCount + 1,
      kind: "turn",
    });
    return {
      from,
      to,
      files: await this.checkpoints.diffTurnCheckpoints({
        projectRoot: input.projectRoot,
        fromRef: from.ref,
        toRef: to.ref,
      }),
    };
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
      const sessionRoot = await this.resolveStoredSessionRoot(input);
      if (sessionRoot) {
        this.assertSameProjectRoot(sessionRoot, projectRoot);
        return { ...project, path: sessionRoot };
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

  private async resolveSessionProject(
    userId: string,
    input: GitTurnCheckpointSessionInput
  ) {
    const project = await this.resolveProject(userId, input.projectId);
    const sessionRoot = this.conversationRollback?.resolveProjectRoot
      ? await this.conversationRollback.resolveProjectRoot({
          userId,
          sessionId: input.sessionId,
          projectId: project.id,
        })
      : project.path;
    return { ...project, path: sessionRoot };
  }

  private async resolveStoredSessionRoot(
    input: CreateAutomaticGitCheckpointInput
  ): Promise<string | undefined> {
    if (!(input.chatId && this.conversationRollback?.resolveProjectRoot)) {
      return undefined;
    }
    return await this.conversationRollback.resolveProjectRoot({
      userId: input.userId,
      sessionId: input.chatId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
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

function requireTurnCheckpoint(
  checkpoints: GitTurnCheckpoint[],
  turnCount: number
): GitTurnCheckpoint {
  const checkpoint = checkpoints.find((item) => item.turnCount === turnCount);
  if (checkpoint) {
    return checkpoint;
  }
  throw new ValidationError("Git turn checkpoint was not found", {
    module: MODULE,
    op: "git.turn-checkpoint.resolve",
    details: { turnCount },
  });
}
