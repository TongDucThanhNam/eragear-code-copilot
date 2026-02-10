/**
 * Project Types
 *
 * Type definitions for project entities, inputs, and updates.
 *
 * @module shared/types/project.types
 */

/**
 * Project entity representing a code repository or workspace
 */
export interface Project {
  /** Unique identifier for the project */
  id: string;
  /** Owning user identifier */
  userId: string;
  /** Display name of the project */
  name: string;
  /** File system path to the project root */
  path: string;
  /** Optional description of the project */
  description: string | null;
  /** Tags associated with the project */
  tags: string[];
  /** Whether the project is marked as favorite */
  favorite: boolean;
  /** Timestamp when the project was created */
  createdAt: number;
  /** Timestamp when the project was last updated */
  updatedAt: number;
  /** Timestamp when the project was last opened, or null */
  lastOpenedAt: number | null;
}

/**
 * Input data for creating a new project
 */
export interface ProjectInput {
  /** Owning user identifier */
  userId: string;
  /** Display name of the project */
  name: string;
  /** File system path to the project root */
  path: string;
  /** Optional description of the project */
  description?: string | null;
  /** Tags to associate with the project */
  tags?: string[];
  /** Whether to mark the project as favorite */
  favorite?: boolean;
}

/**
 * Input data for updating an existing project
 */
export interface ProjectUpdateInput extends Partial<ProjectInput> {
  /** Unique identifier of the project to update */
  id: string;
  /** Owning user identifier */
  userId: string;
}
