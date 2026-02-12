/**
 * Settings Aggregate
 *
 * Domain entity representing the application settings aggregate.
 * Manages UI preferences, project roots, and MCP server configurations.
 *
 * @module modules/settings/domain/settings.entity
 */

import type {
  AppConfig,
  Settings,
  UiSettings,
} from "../../../shared/types/settings.types";

/**
 * SettingsAggregate
 *
 * Aggregate root for application settings. Encapsulates UI configuration,
 * project root directories, and MCP server definitions.
 *
 * @example
 * ```typescript
 * const settings = new SettingsAggregate({
 *   ui: { theme: "dark", accentColor: "#ff0000", density: "comfortable", fontScale: 1 },
 *   projectRoots: ["/projects/my-app"],
 *   mcpServers: []
 * });
 *
 * settings.updateUI({ theme: "light" });
 * settings.addProjectRoot("/projects/shared-lib");
 * ```
 */
export class SettingsAggregate {
  /** UI appearance and behavior settings */
  ui: UiSettings;
  /** List of project root directories */
  projectRoots: string[];
  /** MCP server configurations */
  mcpServers: Settings["mcpServers"];
  /** Runtime app configuration */
  app: AppConfig;

  /**
   * Creates a SettingsAggregate from a Settings configuration
   */
  constructor(config: Settings) {
    this.ui = config.ui;
    this.projectRoots = config.projectRoots;
    this.mcpServers = config.mcpServers;
    this.app = config.app;
  }

  /**
   * Updates the UI settings with a partial patch
   *
   * @param patch - Partial UI settings to merge
   */
  updateUI(patch: Partial<UiSettings>): void {
    this.ui = { ...this.ui, ...patch };
  }

  /**
   * Replaces all project roots with a new set
   *
   * @param roots - New list of project root directories
   * @throws Error if roots array is empty
   */
  setProjectRoots(roots: string[]): void {
    if (!roots || roots.length === 0) {
      throw new Error("At least one project root is required");
    }
    this.projectRoots = roots;
  }

  /**
   * Adds a new project root if it doesn't already exist
   *
   * @param root - The project root to add
   */
  addProjectRoot(root: string): void {
    const trimmed = root.trim();
    if (!trimmed) {
      return;
    }
    if (!this.projectRoots.includes(trimmed)) {
      this.projectRoots.push(trimmed);
    }
  }

  /**
   * Removes a project root if it exists
   *
   * @param root - The project root to remove
   * @throws Error if only one root remains (must keep at least one)
   */
  removeProjectRoot(root: string): void {
    if (this.projectRoots.length <= 1) {
      throw new Error("Must keep at least one project root");
    }
    this.projectRoots = this.projectRoots.filter((r) => r !== root);
  }

  /**
   * Converts the aggregate back to a Settings DTO
   *
   * @returns The complete Settings object
   */
  toDTO(): Settings {
    return {
      ui: this.ui,
      projectRoots: this.projectRoots,
      mcpServers: this.mcpServers,
      app: this.app,
    };
  }
}
