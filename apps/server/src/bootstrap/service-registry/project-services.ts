import {
  CreateProjectService,
  createEventBusProjectLifecycleNotifier,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type { ProjectUseCases } from "@/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type ProjectServiceDependencies = ServiceRegistrySlice<
  "eventBus" | "projectRepo" | "settingsRepo"
>;

export function createProjectUseCases(
  deps: ProjectServiceDependencies
): ProjectUseCases {
  const projectLifecycleNotifier = createEventBusProjectLifecycleNotifier(
    deps.eventBus
  );
  const listProjectsService = new ListProjectsService(deps.projectRepo);
  const createProjectService = new CreateProjectService(
    deps.projectRepo,
    deps.settingsRepo,
    projectLifecycleNotifier
  );
  const updateProjectService = new UpdateProjectService(
    deps.projectRepo,
    deps.settingsRepo,
    projectLifecycleNotifier
  );
  const deleteProjectService = new DeleteProjectService(
    deps.projectRepo,
    projectLifecycleNotifier
  );
  const setActiveProjectService = new SetActiveProjectService(
    deps.projectRepo,
    projectLifecycleNotifier
  );

  return {
    list: listProjectsService,
    create: createProjectService,
    update: updateProjectService,
    delete: deleteProjectService,
    setActive: setActiveProjectService,
  };
}
