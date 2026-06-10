import {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type { ProjectUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createProjectUseCases(
  deps: ServiceRegistryDependencies
): ProjectUseCases {
  const listProjectsService = new ListProjectsService(deps.projectRepo);
  const createProjectService = new CreateProjectService(
    deps.projectRepo,
    deps.settingsRepo,
    deps.eventBus
  );
  const updateProjectService = new UpdateProjectService(
    deps.projectRepo,
    deps.settingsRepo,
    deps.eventBus
  );
  const deleteProjectService = new DeleteProjectService(
    deps.projectRepo,
    deps.eventBus
  );
  const setActiveProjectService = new SetActiveProjectService(
    deps.projectRepo,
    deps.eventBus
  );

  return {
    list: listProjectsService,
    create: createProjectService,
    update: updateProjectService,
    delete: deleteProjectService,
    setActive: setActiveProjectService,
  };
}
