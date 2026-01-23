// Project domain model
import type {
  ProjectInput,
  Project as ProjectType,
} from "../../../shared/types/project.types";

export class Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;

  constructor(config: ProjectType) {
    this.id = config.id;
    this.name = config.name;
    this.path = config.path;
    this.description = config.description;
    this.tags = config.tags;
    this.favorite = config.favorite;
    this.createdAt = config.createdAt;
    this.updatedAt = config.updatedAt;
    this.lastOpenedAt = config.lastOpenedAt;
  }

  static create(input: ProjectInput): Project {
    return new Project({
      id: crypto.randomUUID?.() || `project-${Date.now()}`,
      name: input.name.trim(),
      path: input.path,
      description: input.description ?? null,
      tags: Project.normalizeTags(input.tags),
      favorite: Boolean(input.favorite),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastOpenedAt: null,
    });
  }

  private static normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }
    const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  }

  toDTO(): ProjectType {
    return {
      id: this.id,
      name: this.name,
      path: this.path,
      description: this.description,
      tags: this.tags,
      favorite: this.favorite,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastOpenedAt: this.lastOpenedAt,
    };
  }
}
