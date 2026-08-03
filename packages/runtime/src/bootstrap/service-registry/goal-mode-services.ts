import {
  GitGoalModeWorktreeChangeCollector,
  GoalModeController,
} from "#runtime/modules/goal-mode";
import { SqliteGoalModeStateRepository } from "#runtime/modules/goal-mode/di";
import type {
  GoalModeUseCases,
  ScopeResolutionUseCases,
} from "#runtime/modules/use-cases";
import type { GitAdapter } from "#runtime/platform/git";

export function createGoalModeUseCases(
  scopeResolutionUseCases: ScopeResolutionUseCases,
  gitAdapter: GitAdapter
): GoalModeUseCases {
  return {
    goalMode: new GoalModeController({
      repository: new SqliteGoalModeStateRepository(),
      scopeResolver: scopeResolutionUseCases.scopeResolver,
      worktreeChangeCollector: new GitGoalModeWorktreeChangeCollector(
        gitAdapter
      ),
    }),
  };
}
