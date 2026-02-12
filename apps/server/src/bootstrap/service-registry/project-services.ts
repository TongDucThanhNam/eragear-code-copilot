import {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type { ProjectServiceFactory } from "@/modules/service-factories";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createProjectServices(
  deps: ServiceRegistryDependencies
): ProjectServiceFactory {
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
    listProjects: () => listProjectsService,
    createProject: () => createProjectService,
    updateProject: () => updateProjectService,
    deleteProject: () => deleteProjectService,
    setActiveProject: () => setActiveProjectService,
  };
}
