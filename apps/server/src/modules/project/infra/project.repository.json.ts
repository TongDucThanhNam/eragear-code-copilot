/**
 * Project JSON Repository
 *
 * JSON-backed implementation of the ProjectRepositoryPort.
 * Persists project configurations to a local JSON file in `.eragear` directory.
 * Enforces project path resolution and validation against allowed roots.
 *
 * @module modules/project/infra/project.repository.json
 */

import { resolveProjectPath } from "@/shared/utils/project-roots.util";
import { readJsonFile, writeJsonFile } from "../../../infra/storage/json-store";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "../../../shared/types/project.types";
import type { ProjectRepositoryPort } from "../application/ports/project-repository.port";

/** Storage file name for projects data */
const PROJECTS_FILE = "projects.json";

/**
 * JSON repository for project persistence
 * Implements ProjectRepositoryPort using local JSON file storage
 * Enforces path validation against configured allowed roots
 */
export class ProjectJsonRepository implements ProjectRepositoryPort {
  /** Array of allowed project root directories */
  private allowedRoots: string[];

  /**
   * Creates a ProjectJsonRepository with allowed root directories
   * @param allowedRoots - Array of directory paths where projects can be created
   */
  constructor(allowedRoots: string[]) {
    this.allowedRoots = allowedRoots;
  }

  /**
   * Updates the allowed root directories
   * @param roots - New array of allowed root directories
   */
  setAllowedRoots(roots: string[]): void {
    this.allowedRoots = roots;
  }

  /**
   * Retrieves all projects data including active project ID
   * @returns Object containing projects array and active project ID
   */
  private getProjectsData(): {
    projects: Project[];
    activeProjectId: string | null;
  } {
    return readJsonFile(PROJECTS_FILE, { projects: [], activeProjectId: null });
  }

  /**
   * Persists projects data to JSON file
   * @param data - Object containing projects array and active project ID
   */
  private saveProjectsData(data: {
    projects: Project[];
    activeProjectId: string | null;
  }): void {
    writeJsonFile(PROJECTS_FILE, data);
  }

  /**
   * Finds a project by ID
   * @param id - Project ID to find
   * @returns Project or undefined if not found
   */
  findById(id: string): Project | undefined {
    const data = this.getProjectsData();
    return data.projects.find((p) => p.id === id);
  }

  /**
   * Retrieves all projects
   * @returns Array of all projects
   */
  findAll(): Project[] {
    const data = this.getProjectsData();
    return data.projects;
  }

  /**
   * Gets the currently active project ID
   * @returns Active project ID or null if none
   */
  getActiveId(): string | null {
    const data = this.getProjectsData();
    return data.activeProjectId;
  }

  /**
   * Creates a new project
   *
   * @param input - Project creation input
   * @returns The created project
   * @throws Error if name is empty or project path already exists
   */
  create(input: ProjectInput): Project {
    const data = this.getProjectsData();
    const resolvedPath = resolveProjectPath(input.path, this.allowedRoots);
    const name = input.name.trim();

    if (!name) {
      throw new Error("Project name is required");
    }

    const existing = data.projects.find((p) => p.path === resolvedPath);
    if (existing) {
      throw new Error(`Project path already exists: ${resolvedPath}`);
    }

    const now = Date.now();
    const project: Project = {
      id: crypto.randomUUID?.() || `project-${Date.now()}`,
      name,
      path: resolvedPath,
      description: input.description ?? null,
      tags: this.normalizeTags(input.tags),
      favorite: Boolean(input.favorite),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };

    data.projects.push(project);
    this.saveProjectsData(data);
    return project;
  }

  /**
   * Updates an existing project
   *
   * @param input - Project update input
   * @returns The updated project
   * @throws Error if project not found or path already exists
   */
  update(input: ProjectUpdateInput): Project {
    const data = this.getProjectsData();
    const index = data.projects.findIndex((p) => p.id === input.id);

    if (index === -1) {
      throw new Error("Project not found");
    }

    const current = data.projects[index];
    if (!current) {
      throw new Error("Project not found");
    }
    let nextPath = current.path;

    if (input.path && input.path !== current.path) {
      nextPath = resolveProjectPath(input.path, this.allowedRoots);
      const exists = data.projects.some(
        (p) => p.id !== input.id && p.path === nextPath
      );
      if (exists) {
        throw new Error(`Project path already exists: ${nextPath}`);
      }
    }

    const updated: Project = {
      ...current,
      name: input.name ? input.name.trim() || current.name : current.name,
      path: nextPath,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      tags: input.tags ? this.normalizeTags(input.tags) : current.tags,
      favorite:
        input.favorite === undefined ? current.favorite : input.favorite,
      updatedAt: Date.now(),
    };

    data.projects[index] = updated;
    this.saveProjectsData(data);
    return updated;
  }

  /**
   * Deletes a project by ID
   * Clears active project ID if the deleted project was active
   *
   * @param id - Project ID to delete
   */
  delete(id: string): void {
    const data = this.getProjectsData();
    const nextProjects = data.projects.filter((p) => p.id !== id);
    const activeProjectId =
      data.activeProjectId === id ? null : data.activeProjectId;
    this.saveProjectsData({ projects: nextProjects, activeProjectId });
  }

  /**
   * Sets the active project
   * Updates the last opened timestamp for the newly active project
   *
   * @param id - Project ID to set as active, or null for none
   * @throws Error if the specified project doesn't exist
   */
  setActive(id: string | null): void {
    const data = this.getProjectsData();
    if (id) {
      const project = data.projects.find((p) => p.id === id);
      if (!project) {
        throw new Error("Project not found");
      }
      project.lastOpenedAt = Date.now();
      project.updatedAt = Date.now();
    }
    data.activeProjectId = id;
    this.saveProjectsData(data);
  }

  /**
   * Normalizes an array of tags by trimming whitespace and removing duplicates
   *
   * @param tags - Array of tag strings
   * @returns Array of unique, non-empty trimmed tags
   */
  private normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }
    const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  }
}
