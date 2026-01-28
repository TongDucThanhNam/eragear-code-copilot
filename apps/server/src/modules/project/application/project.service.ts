/**
 * Project Service
 *
 * Application service for managing project lifecycle and operations.
 * Provides CRUD operations for projects and manages active project state.
 *
 * @module modules/project/application/project.service
 */

import type {
  ProjectInput,
  ProjectUpdateInput,
} from "../../../shared/types/project.types";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class ProjectService {
  /** Repository for project persistence operations */
  private readonly projectRepo: ProjectRepositoryPort;

  /**
   * Creates a ProjectService with the given repository
   * @param projectRepo - The project repository implementation
   */
  constructor(projectRepo: ProjectRepositoryPort) {
    this.projectRepo = projectRepo;
  }

  /**
   * Lists all projects with active project information
   *
   * @returns Object containing projects array and active project ID
   */
  listProjects() {
    return {
      projects: this.projectRepo.findAll(),
      activeProjectId: this.projectRepo.getActiveId(),
    };
  }

  /**
   * Creates a new project
   *
   * @param input - Project creation input
   * @returns The created project
   */
  createProject(input: ProjectInput) {
    return this.projectRepo.create(input);
  }

  /**
   * Updates an existing project
   *
   * @param input - Project update input
   * @returns The updated project
   */
  updateProject(input: ProjectUpdateInput) {
    return this.projectRepo.update(input);
  }

  /**
   * Deletes a project by ID
   *
   * @param id - Project ID to delete
   * @returns Success status
   */
  deleteProject(id: string) {
    this.projectRepo.delete(id);
    return { ok: true };
  }

  /**
   * Sets the active project
   *
   * @param id - Project ID to set as active, or null for none
   * @returns The active project ID
   */
  setActiveProject(id: string | null) {
    return this.projectRepo.setActive(id);
  }
}
