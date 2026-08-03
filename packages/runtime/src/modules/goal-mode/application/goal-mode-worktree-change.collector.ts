import type { GitChangedFile, GitRepositoryPort } from "#runtime/modules/git";
import type {
  GoalModeWorktreeChangeCollectorPort,
  GoalModeWorktreeChangeSet,
} from "./ports/goal-mode-worktree-change.port";

export class GitGoalModeWorktreeChangeCollector
  implements GoalModeWorktreeChangeCollectorPort
{
  private readonly git: GitRepositoryPort;

  constructor(git: GitRepositoryPort) {
    this.git = git;
  }

  async collect(input: {
    projectRoot: string;
  }): Promise<GoalModeWorktreeChangeSet> {
    const state = await this.git.getRepositoryState(input.projectRoot);
    if (!state.isRepository) {
      throw new Error(
        state.error ??
          "Goal Mode requires a Git repository to collect file changes."
      );
    }
    if (state.error) {
      throw new Error(state.error);
    }
    return collectGoalModeWorktreeChanges(state.changedFiles);
  }
}

export function collectGoalModeWorktreeChanges(
  changedFiles: GitChangedFile[]
): GoalModeWorktreeChangeSet {
  const filesTouched = new Set<string>();
  const filesCreated = new Set<string>();
  const filesDeleted = new Set<string>();

  for (const file of changedFiles) {
    const path = normalizePath(file.path);
    const oldPath = file.oldPath ? normalizePath(file.oldPath) : undefined;

    switch (file.status) {
      case "added":
      case "copied":
      case "untracked":
        filesCreated.add(path);
        break;
      case "deleted":
        filesDeleted.add(path);
        break;
      case "renamed":
        filesCreated.add(path);
        if (oldPath) {
          filesDeleted.add(oldPath);
        }
        break;
      case "modified":
      case "conflicted":
      case "unknown":
        filesTouched.add(path);
        break;
      default:
        filesTouched.add(path);
        break;
    }
  }

  return {
    filesTouched: sortSet(filesTouched),
    filesCreated: sortSet(filesCreated),
    filesDeleted: sortSet(filesDeleted),
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function sortSet(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
