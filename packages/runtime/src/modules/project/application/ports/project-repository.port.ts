import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "#runtime/shared/types/project.types";

export interface ProjectListWithActiveState {
  projects: Project[];
  activeProjectId: string | null;
}

/**
 * Project persistence port scoped by user.
 *
 * Invariant: project IDs and active-project state are tenant-owned; adapters
 * must not return or mutate projects for a different `userId`.
 */
export interface ProjectRepositoryPort {
  /** Find a project by ID */
  findById(id: string, userId: string): Promise<Project | undefined>;
  /** Find a project by path */
  findByPath(path: string): Promise<Project | undefined>;
  /** Find all projects */
  findAll(userId: string): Promise<Project[]>;
  /** Get the currently active project ID */
  getActiveId(userId: string): Promise<string | null>;
  /** List projects and repair missing/dangling active state */
  listWithActiveState(userId: string): Promise<ProjectListWithActiveState>;
  /** Create a new project */
  create(input: ProjectInput): Promise<Project>;
  /** Update an existing project */
  update(input: ProjectUpdateInput): Promise<Project>;
  /** Delete a project */
  delete(id: string, userId: string): Promise<void>;
  /** Delete a project and clear missing/dangling active state */
  deleteAndClearActive(
    id: string,
    userId: string
  ): Promise<{ activeProjectId: string | null }>;
  /** Set the active project */
  setActive(id: string | null, userId: string): Promise<void>;
}
