import path from "node:path";
import type { GitWorkflowPort } from "#runtime/modules/git";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type { ChatSession } from "#runtime/shared/types/session.types";
import type { SessionEnvironmentMode } from "./contracts/session.contract";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.environment.switch";

interface StopSessionPort {
  execute(userId: string, chatId: string): Promise<{ ok: true }>;
}

interface CreateSessionPort {
  execute(params: CreateSessionParams): Promise<ChatSession>;
}

export interface SwitchSessionEnvironmentInput {
  userId: string;
  chatId: string;
  envMode: SessionEnvironmentMode;
}

export interface SwitchSessionEnvironmentResult {
  chatId: string;
  envMode: SessionEnvironmentMode;
  projectRoot: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

/**
 * Restarts a user-owned chat in either its canonical project root or a
 * persistent Eragear-owned Git worktree.
 *
 * Ordering contract: create/verify the target root first, stop the current
 * runtime second, persist the new root third, then bootstrap the same local
 * chat id with a fresh ACP session.
 */
export class SwitchSessionEnvironmentService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly workflow: Pick<
    GitWorkflowPort,
    "createWorktree" | "getStatus" | "listWorktrees"
  >;
  private readonly stopSession: StopSessionPort;
  private readonly createSession: CreateSessionPort;
  private readonly sessionRuntime: Pick<SessionRuntimePort, "get">;

  constructor(
    sessionRepo: SessionRepositoryPort,
    projectRepo: ProjectRepositoryPort,
    workflow: Pick<
      GitWorkflowPort,
      "createWorktree" | "getStatus" | "listWorktrees"
    >,
    stopSession: StopSessionPort,
    createSession: CreateSessionPort,
    sessionRuntime: Pick<SessionRuntimePort, "get">
  ) {
    this.sessionRepo = sessionRepo;
    this.projectRepo = projectRepo;
    this.workflow = workflow;
    this.stopSession = stopSession;
    this.createSession = createSession;
    this.sessionRuntime = sessionRuntime;
  }

  async syncBranch(input: {
    userId: string;
    chatId: string;
  }): Promise<{ worktreeBranch: string }> {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!(stored?.envMode === "worktree" && stored.worktreePath)) {
      throw new ValidationError("Session is not using a Git worktree", {
        module: "session",
        op: `${OP}.sync-branch`,
        details: { chatId: input.chatId },
      });
    }
    const status = await this.workflow.getStatus(stored.projectRoot);
    if (!(status.isRepository && status.refName)) {
      throw new ValidationError("The worktree branch could not be resolved", {
        module: "session",
        op: `${OP}.sync-branch`,
        details: { chatId: input.chatId },
      });
    }
    await this.sessionRepo.updateMetadata(input.chatId, input.userId, {
      worktreeBranch: status.refName,
    });
    const runtimeSession = this.sessionRuntime.get(input.chatId);
    if (runtimeSession?.userId === input.userId) {
      runtimeSession.worktreeBranch = status.refName;
    }
    return { worktreeBranch: status.refName };
  }

  async execute(
    input: SwitchSessionEnvironmentInput
  ): Promise<SwitchSessionEnvironmentResult> {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId: input.chatId },
      });
    }
    if (!stored.projectId) {
      throw new ValidationError(
        "A persisted project is required for worktree switching",
        {
          module: "session",
          op: OP,
          details: { chatId: input.chatId },
        }
      );
    }
    const project = await this.projectRepo.findById(
      stored.projectId,
      input.userId
    );
    if (!project) {
      throw new NotFoundError("Project not found", {
        module: "session",
        op: OP,
        details: { projectId: stored.projectId },
      });
    }

    const worktree =
      input.envMode === "worktree"
        ? await this.resolveWorktree({
            projectRoot: project.path,
            chatId: stored.id,
            worktreePath: stored.worktreePath,
            worktreeBranch: stored.worktreeBranch,
          })
        : undefined;
    const projectRoot = worktree?.path ?? project.path;
    const worktreePath = worktree?.path ?? stored.worktreePath;
    const worktreeBranch = worktree?.branchName ?? stored.worktreeBranch;

    await this.stopSession.execute(input.userId, input.chatId);
    await this.sessionRepo.updateMetadata(input.chatId, input.userId, {
      sessionId: undefined,
      status: "stopped",
      projectRoot,
      cwd: projectRoot,
      envMode: input.envMode,
      worktreePath,
      worktreeBranch,
    });
    await this.createSession.execute({
      userId: input.userId,
      projectId: project.id,
      projectRoot,
      ...(input.envMode === "worktree"
        ? { trustedProjectRoot: projectRoot }
        : {}),
      ...(stored.agentId ? { agentId: stored.agentId } : {}),
      ...(stored.command ? { command: stored.command } : {}),
      ...(stored.args ? { args: stored.args } : {}),
      ...(stored.env ? { env: stored.env } : {}),
      chatId: stored.id,
      envMode: input.envMode,
      worktreePath,
      worktreeBranch,
      importExternalHistoryOnLoad: false,
    });

    return {
      chatId: stored.id,
      envMode: input.envMode,
      projectRoot,
      ...(worktreePath ? { worktreePath } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
    };
  }

  private async resolveWorktree(input: {
    projectRoot: string;
    chatId: string;
    worktreePath?: string;
    worktreeBranch?: string;
  }) {
    if (input.worktreePath) {
      const registered = (
        await this.workflow.listWorktrees({
          projectRoot: input.projectRoot,
        })
      ).find(
        (candidate) =>
          path.resolve(candidate.path) ===
          path.resolve(input.worktreePath ?? "")
      );
      if (registered) {
        return registered;
      }
    }
    return await this.workflow.createWorktree({
      projectRoot: input.projectRoot,
      worktreeId: input.chatId,
      ...(input.worktreeBranch ? { branchName: input.worktreeBranch } : {}),
    });
  }
}
