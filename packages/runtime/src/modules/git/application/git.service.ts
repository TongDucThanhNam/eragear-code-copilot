import type {
  ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import { NotFoundError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  GitProjectInput,
  GitRepositorySummary,
} from "./contracts/git.contract";
import type { GitRepositoryPort } from "./ports/git-repository.port";

const MODULE = "git";
const OP_RESOLVE_PROJECT = "git.resolve-project";

export class GitService {
  private readonly git: GitRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly activeProjectResolver: ResolveActiveProjectService;
  private readonly clock: ClockPort;

  constructor(
    git: GitRepositoryPort,
    projectRepo: ProjectRepositoryPort,
    activeProjectResolver: ResolveActiveProjectService,
    clock: ClockPort
  ) {
    this.git = git;
    this.projectRepo = projectRepo;
    this.activeProjectResolver = activeProjectResolver;
    this.clock = clock;
  }

  async getRepositorySummary(
    userId: string,
    input?: GitProjectInput
  ): Promise<GitRepositorySummary> {
    const project = await this.resolveProject(userId, input?.projectId);
    const state = await this.git.getRepositoryState(project.path);
    const changedFiles = state.changedFiles;

    return {
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
      isRepository: state.isRepository,
      branch: state.branch,
      head: state.head,
      upstream: state.upstream,
      ahead: state.ahead,
      behind: state.behind,
      changedFiles,
      totalChanged: changedFiles.length,
      stagedCount: changedFiles.filter((file) => file.staged).length,
      unstagedCount: changedFiles.filter((file) => file.unstaged).length,
      untrackedCount: changedFiles.filter((file) => file.status === "untracked")
        .length,
      checkedAt: new Date(this.clock.nowMs()).toISOString(),
      error: state.error,
    };
  }

  async getChanges(userId: string, input?: GitProjectInput) {
    const summary = await this.getRepositorySummary(userId, input);
    return {
      projectId: summary.projectId,
      projectName: summary.projectName,
      projectRoot: summary.projectRoot,
      isRepository: summary.isRepository,
      changedFiles: summary.changedFiles,
      checkedAt: summary.checkedAt,
      error: summary.error,
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
      op: OP_RESOLVE_PROJECT,
    });
  }
}
