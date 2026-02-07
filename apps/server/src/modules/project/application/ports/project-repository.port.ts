import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";

/**
 * Port for project data persistence operations.
 */
export interface ProjectRepositoryPort {
  /** Find a project by ID */
  findById(id: string): Promise<Project | undefined>;
  /** Find all projects */
  findAll(): Promise<Project[]>;
  /** Get the currently active project ID */
  getActiveId(): Promise<string | null>;
  /** Create a new project */
  create(input: ProjectInput): Promise<Project>;
  /** Update an existing project */
  update(input: ProjectUpdateInput): Promise<Project>;
  /** Delete a project */
  delete(id: string): Promise<void>;
  /** Set the active project */
  setActive(id: string | null): Promise<void>;
  /** Set allowed project roots */
  setAllowedRoots(roots: string[]): Promise<void>;
}
