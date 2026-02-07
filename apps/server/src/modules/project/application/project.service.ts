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
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "../../session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "../../session/application/ports/session-runtime.port";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";

export class ProjectService {
  /** Repository for project persistence operations */
  private readonly projectRepo: ProjectRepositoryPort;
  /** Repository for session persistence operations */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a ProjectService with the given repository
   * @param projectRepo - The project repository implementation
   */
  constructor(
    projectRepo: ProjectRepositoryPort,
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.projectRepo = projectRepo;
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Lists all projects with active project information
   *
   * @returns Object containing projects array and active project ID
   */
  async listProjects() {
    return {
      projects: await this.projectRepo.findAll(),
      activeProjectId: await this.projectRepo.getActiveId(),
    };
  }

  /**
   * Creates a new project
   *
   * @param input - Project creation input
   * @returns The created project
   */
  async createProject(input: ProjectInput) {
    return await this.projectRepo.create(input);
  }

  /**
   * Updates an existing project
   *
   * @param input - Project update input
   * @returns The updated project
   */
  async updateProject(input: ProjectUpdateInput) {
    return await this.projectRepo.update(input);
  }

  /**
   * Deletes a project by ID
   *
   * @param id - Project ID to delete
   * @returns Success status
   */
  async deleteProject(id: string) {
    const project = await this.projectRepo.findById(id);
    if (project) {
      const sessions = await this.sessionRepo.findAll();
      const linkedSessions = sessions.filter(
        (session) =>
          session.projectId === project.id ||
          session.projectRoot === project.path
      );

      for (const session of linkedSessions) {
        const runtimeSession = this.sessionRuntime.get(session.id);
        if (runtimeSession) {
          terminateSessionTerminals(runtimeSession);
          if (!runtimeSession.proc.killed) {
            runtimeSession.proc.kill("SIGTERM");
          }
          this.sessionRuntime.delete(session.id);
        }
        await this.sessionRepo.delete(session.id);
      }
    }

    await this.projectRepo.delete(id);
    return { ok: true };
  }

  /**
   * Sets the active project
   *
   * @param id - Project ID to set as active, or null for none
   * @returns The active project ID
   */
  async setActiveProject(id: string | null) {
    await this.projectRepo.setActive(id);
    return { activeProjectId: id };
  }
}
