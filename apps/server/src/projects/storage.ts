import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveProjectPath } from "../utils/project-roots";

const STORAGE_DIR = path.join(process.cwd(), ".eragear");
const PROJECTS_FILE = path.join(STORAGE_DIR, "projects.json");

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastOpenedAt: z.number().nullable().optional(),
});

const ProjectsFileSchema = z.object({
  projects: z.array(ProjectSchema),
  activeProjectId: z.string().nullable(),
});

export type Project = z.infer<typeof ProjectSchema>;

export type ProjectInput = {
  name: string;
  path: string;
  description?: string | null;
  tags?: string[];
  favorite?: boolean;
};

export type ProjectUpdateInput = {
  id: string;
  name?: string;
  path?: string;
  description?: string | null;
  tags?: string[];
  favorite?: boolean;
};

function ensureProjectsFile() {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!existsSync(PROJECTS_FILE)) {
    writeFileSync(
      PROJECTS_FILE,
      JSON.stringify({ projects: [], activeProjectId: null }, null, 2)
    );
  }
}

function loadProjectsFile(): z.infer<typeof ProjectsFileSchema> {
  ensureProjectsFile();
  try {
    const raw = readFileSync(PROJECTS_FILE, "utf-8");
    return ProjectsFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error("[Projects] Failed to load projects:", err);
    const fallback = { projects: [], activeProjectId: null };
    writeFileSync(PROJECTS_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveProjectsFile(data: z.infer<typeof ProjectsFileSchema>) {
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
  return Array.from(new Set(trimmed));
}

export function listProjects() {
  return loadProjectsFile();
}

export function getProjectById(id: string): Project | undefined {
  const data = loadProjectsFile();
  return data.projects.find((project) => project.id === id);
}

export function createProject(
  input: ProjectInput,
  allowedRoots: string[]
): Project {
  const data = loadProjectsFile();
  const resolvedPath = resolveProjectPath(input.path, allowedRoots);
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name is required");
  }

  const existing = data.projects.find(
    (project) => project.path === resolvedPath
  );
  if (existing) {
    throw new Error(`Project path already exists: ${resolvedPath}`);
  }

  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    path: resolvedPath,
    description: input.description ?? null,
    tags: normalizeTags(input.tags),
    favorite: Boolean(input.favorite),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
  };

  data.projects.push(project);
  saveProjectsFile(data);
  return project;
}

export function updateProject(
  input: ProjectUpdateInput,
  allowedRoots: string[]
): Project {
  const data = loadProjectsFile();
  const index = data.projects.findIndex((project) => project.id === input.id);
  if (index === -1) {
    throw new Error("Project not found");
  }

  const current = data.projects[index]!;
  let nextPath = current.path;
  if (input.path && input.path !== current.path) {
    nextPath = resolveProjectPath(input.path, allowedRoots);
    const exists = data.projects.some(
      (project) => project.id !== input.id && project.path === nextPath
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
      input.description === undefined ? current.description : input.description,
    tags: input.tags ? normalizeTags(input.tags) : current.tags,
    favorite: input.favorite === undefined ? current.favorite : input.favorite,
    updatedAt: Date.now(),
  };

  data.projects[index] = updated;
  saveProjectsFile(data);
  return updated;
}

export function deleteProject(id: string) {
  const data = loadProjectsFile();
  const nextProjects = data.projects.filter((project) => project.id !== id);
  const activeProjectId =
    data.activeProjectId === id ? null : data.activeProjectId;
  saveProjectsFile({ projects: nextProjects, activeProjectId });
}

export function setActiveProject(id: string | null) {
  const data = loadProjectsFile();
  if (id) {
    const project = data.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("Project not found");
    }
    project.lastOpenedAt = Date.now();
    project.updatedAt = Date.now();
  }
  data.activeProjectId = id;
  saveProjectsFile(data);
  return data;
}
