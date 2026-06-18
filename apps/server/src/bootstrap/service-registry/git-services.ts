import { GitCheckpointService, GitService } from "@/modules/git";
import { ResolveActiveProjectService } from "@/modules/project";
import type { GitUseCases } from "@/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type GitServiceDependencies = ServiceRegistrySlice<
  "gitAdapter" | "projectRepo" | "clock"
>;

export function createGitUseCases(deps: GitServiceDependencies): GitUseCases {
  const activeProjectResolver = new ResolveActiveProjectService(
    deps.projectRepo
  );

  return {
    repository: new GitService(
      deps.gitAdapter,
      deps.projectRepo,
      activeProjectResolver,
      deps.clock
    ),
    checkpoints: new GitCheckpointService(
      deps.gitAdapter,
      deps.projectRepo,
      activeProjectResolver,
      deps.clock
    ),
  };
}
