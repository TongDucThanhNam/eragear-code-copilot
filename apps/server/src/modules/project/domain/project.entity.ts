/**
 * Project Domain Entity
 *
 * Core domain model representing a project workspace.
 * Encapsulates project properties, metadata, and business rules.
 *
 * @module modules/project/domain/project.entity
 */

import { randomUUID } from "node:crypto";
import type {
  ProjectInput,
  Project as ProjectType,
} from "../../../shared/types/project.types";

export class Project {
  /** Unique identifier for the project */
  id: string;
  /** Display name of the project */
  name: string;
  /** File system path to the project root */
  path: string;
  /** Optional description of the project */
  description: string | null;
  /** Tags associated with the project for categorization */
  tags: string[];
  /** Whether the project is marked as favorite */
  favorite: boolean;
  /** Timestamp when the project was created */
  createdAt: number;
  /** Timestamp when the project was last updated */
  updatedAt: number;
  /** Timestamp when the project was last opened (null if never opened) */
  lastOpenedAt: number | null;

  /**
   * Creates a Project instance from a configuration object
   * @param config - Project configuration object
   */
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

  /**
   * Factory method to create a new Project from input data
   *
   * @param input - Project input data (name, path, description, tags, etc.)
   * @returns A new Project instance with generated ID and normalized tags
   *
   * @example
   * ```typescript
   * const project = Project.create({
   *   name: "My App",
   *   path: "/path/to/project",
   *   tags: ["react", "typescript"]
   * });
   * ```
   */
  static create(input: ProjectInput): Project {
    return new Project({
      id: randomUUID(),
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

  /**
   * Normalizes an array of tags by trimming whitespace and removing duplicates
   *
   * @param tags - Array of tag strings (may include duplicates, empty strings)
   * @returns Array of unique, non-empty trimmed tags
   */
  private static normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }
    const trimmed = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(trimmed));
  }

  /**
   * Converts the project to a DTO representation for storage/transmission
   *
   * @returns Project configuration object suitable for storage or API responses
   */
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
