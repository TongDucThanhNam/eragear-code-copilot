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
  findById(id: string): Project | undefined;
  /** Find all projects */
  findAll(): Project[];
  /** Get the currently active project ID */
  getActiveId(): string | null;
  /** Create a new project */
  create(input: ProjectInput): Project;
  /** Update an existing project */
  update(input: ProjectUpdateInput): Project;
  /** Delete a project */
  delete(id: string): void;
  /** Set the active project */
  setActive(id: string | null): void;
  /** Set allowed project roots */
  setAllowedRoots(roots: string[]): void;
}
