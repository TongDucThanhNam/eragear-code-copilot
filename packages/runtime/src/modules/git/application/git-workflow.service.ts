import type {
  ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "#runtime/shared/errors";
import type {
  GitBranchDiffInput,
  GitWorkflowActionInput,
  GitWorkflowActionResult,
  GitWorkflowProgress,
  GitWorkflowProgressInput,
  GitWorkflowProjectInput,
  GitWorkflowStatus,
} from "./contracts/git-workflow.contract";
import type { GitWorkflowPort } from "./ports/git-workflow.port";
import type { TurnConversationRollbackPort } from "./ports/turn-conversation-rollback.port";

const MODULE = "git";
const OP = "git.workflow";

interface ProgressChannel {
  ownerId: string;
  listeners: Set<(event: GitWorkflowProgress) => void>;
  terminal: boolean;
}

export class GitWorkflowService {
  private readonly channels = new Map<string, ProgressChannel>();
  private readonly workflow: GitWorkflowPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly activeProjectResolver: ResolveActiveProjectService;
  private readonly sessionRootResolver?: Pick<
    TurnConversationRollbackPort,
    "resolveProjectRoot"
  >;

  constructor(
    workflow: GitWorkflowPort,
    projectRepo: ProjectRepositoryPort,
    activeProjectResolver: ResolveActiveProjectService,
    sessionRootResolver?: Pick<
      TurnConversationRollbackPort,
      "resolveProjectRoot"
    >
  ) {
    this.workflow = workflow;
    this.projectRepo = projectRepo;
    this.activeProjectResolver = activeProjectResolver;
    this.sessionRootResolver = sessionRootResolver;
  }

  async getStatus(
    userId: string,
    input?: GitWorkflowProjectInput
  ): Promise<GitWorkflowStatus> {
    const project = await this.resolveWorkflowRoot(
      userId,
      input?.projectId,
      input?.sessionId
    );
    return await this.workflow.getStatus(project.path);
  }

  async executeAction(
    userId: string,
    input: GitWorkflowActionInput
  ): Promise<GitWorkflowActionResult> {
    const project = await this.resolveWorkflowRoot(
      userId,
      input.projectId,
      input.sessionId
    );
    const channel = this.ensureChannel(userId, input.actionId);
    try {
      const before = await this.workflow.getStatus(project.path);
      if (!before.isRepository) {
        throw new ValidationError(
          "The selected project is not a Git repository",
          {
            module: MODULE,
            op: OP,
          }
        );
      }
      if (before.isDefaultRef && input.confirmDefaultBranch !== true) {
        throw new ConflictError(
          "Confirmation is required before changing the default branch",
          {
            module: MODULE,
            op: `${OP}.default-branch-guard`,
            details: { refName: before.refName, action: input.action },
          }
        );
      }
      const result = await this.workflow.runStackedAction(
        {
          projectRoot: project.path,
          actionId: input.actionId,
          action: input.action,
          ...(input.message ? { message: input.message } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.base ? { base: input.base } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        },
        (event) => {
          for (const listener of channel.listeners) {
            listener(event);
          }
        }
      );
      channel.terminal = true;
      return {
        actionId: input.actionId,
        action: input.action,
        status: await this.workflow.getStatus(project.path),
        ...(result.commitSha ? { commitSha: result.commitSha } : {}),
        pushed: result.pushed,
        ...(result.pr ? { pr: result.pr } : {}),
      };
    } catch (error) {
      channel.terminal = true;
      throw error;
    }
  }

  async getBranchDiff(
    userId: string,
    input: GitBranchDiffInput
  ): Promise<{ patch: string }> {
    const project = await this.resolveWorkflowRoot(
      userId,
      input.projectId,
      input.sessionId
    );
    return {
      patch: await this.workflow.getBranchDiff({
        projectRoot: project.path,
        ...(input.base ? { base: input.base } : {}),
      }),
    };
  }

  subscribeProgress(
    userId: string,
    input: GitWorkflowProgressInput,
    listener: (event: GitWorkflowProgress) => void
  ): () => void {
    const channel = this.ensureChannel(userId, input.actionId);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
      if (channel.terminal && channel.listeners.size === 0) {
        this.channels.delete(input.actionId);
      }
    };
  }

  private ensureChannel(userId: string, actionId: string): ProgressChannel {
    const existing = this.channels.get(actionId);
    if (existing) {
      if (existing.ownerId !== userId) {
        throw new NotFoundError("Git action progress channel not found", {
          module: MODULE,
          op: `${OP}.progress`,
          details: { actionId },
        });
      }
      return existing;
    }
    const channel: ProgressChannel = {
      ownerId: userId,
      listeners: new Set(),
      terminal: false,
    };
    this.channels.set(actionId, channel);
    return channel;
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
          op: `${OP}.resolve-project`,
          details: { projectId: requestedProjectId },
        });
      }
      return project;
    }
    return await this.activeProjectResolver.execute(userId, {
      module: MODULE,
      op: `${OP}.resolve-project`,
    });
  }

  private async resolveWorkflowRoot(
    userId: string,
    projectId?: string,
    sessionId?: string
  ) {
    const project = await this.resolveProject(userId, projectId);
    if (!(sessionId && this.sessionRootResolver?.resolveProjectRoot)) {
      return project;
    }
    return {
      ...project,
      path: await this.sessionRootResolver.resolveProjectRoot({
        userId,
        sessionId,
        projectId: project.id,
      }),
    };
  }
}
