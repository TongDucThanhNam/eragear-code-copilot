// Project storage adapter
import { readJsonFile, writeJsonFile } from './json-store';
import type { ProjectRepositoryPort } from '../../shared/types/ports';
import type { Project, ProjectInput, ProjectUpdateInput } from '../../shared/types/project.types';
import { resolveProjectPath } from '../../shared/utils';

const PROJECTS_FILE = 'projects.json';

export class ProjectStorageAdapter implements ProjectRepositoryPort {
  constructor(private allowedRoots: string[]) {}

  private getProjectsData(): { projects: Project[]; activeProjectId: string | null } {
    return readJsonFile(PROJECTS_FILE, { projects: [], activeProjectId: null });
  }

  private saveProjectsData(data: { projects: Project[]; activeProjectId: string | null }): void {
    writeJsonFile(PROJECTS_FILE, data);
  }

  findById(id: string): Project | undefined {
    const data = this.getProjectsData();
    return data.projects.find((p) => p.id === id);
  }

  findAll(): Project[] {
    const data = this.getProjectsData();
    return data.projects;
  }

  create(input: ProjectInput): Project {
    const data = this.getProjectsData();
    const resolvedPath = resolveProjectPath(input.path, this.allowedRoots);
    const name = input.name.trim();

    if (!name) {
      throw new Error('Project name is required');
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

  update(input: ProjectUpdateInput): Project {
    const data = this.getProjectsData();
    const index = data.projects.findIndex((p) => p.id === input.id);

    if (index === -1) {
      throw new Error('Project not found');
    }

    const current = data.projects[index]!;
    let nextPath = current.path;

    if (input.path && input.path !== current.path) {
      nextPath = resolveProjectPath(input.path, this.allowedRoots);
      const exists = data.projects.some((p) => p.id !== input.id && p.path === nextPath);
      if (exists) {
        throw new Error(`Project path already exists: ${nextPath}`);
      }
    }

    const updated: Project = {
      ...current,
      name: input.name ? input.name.trim() || current.name : current.name,
      path: nextPath,
      description: input.description === undefined ? current.description : input.description,
      tags: input.tags ? this.normalizeTags(input.tags) : current.tags,
      favorite: input.favorite === undefined ? current.favorite : input.favorite,
      updatedAt: Date.now(),
    };

    data.projects[index] = updated;
    this.saveProjectsData(data);
    return updated;
  }

  delete(id: string): void {
    const data = this.getProjectsData();
    const nextProjects = data.projects.filter((p) => p.id !== id);
    const activeProjectId = data.activeProjectId === id ? null : data.activeProjectId;
    this.saveProjectsData({ projects: nextProjects, activeProjectId });
  }

  setActive(id: string | null): void {
    const data = this.getProjectsData();
    if (id) {
      const project = data.projects.find((p) => p.id === id);
      if (!project) {
        throw new Error('Project not found');
      }
      project.lastOpenedAt = Date.now();
      project.updatedAt = Date.now();
    }
    data.activeProjectId = id;
    this.saveProjectsData(data);
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags) return [];
    const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  }
}
