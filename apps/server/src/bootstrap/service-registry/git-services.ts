import { GitCheckpointService, GitService } from "@/modules/git";
import type { GitUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createGitUseCases(
  deps: ServiceRegistryDependencies
): GitUseCases {
  return {
    repository: new GitService(deps.gitAdapter, deps.projectRepo, deps.clock),
    checkpoints: new GitCheckpointService(
      deps.gitAdapter,
      deps.projectRepo,
      deps.clock
    ),
  };
}
