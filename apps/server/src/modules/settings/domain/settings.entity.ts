// Settings domain model
import type {
  Settings,
  UiSettings,
} from "../../../shared/types/settings.types";

export class SettingsAggregate {
  ui: UiSettings;
  projectRoots: string[];

  constructor(config: Settings) {
    this.ui = config.ui;
    this.projectRoots = config.projectRoots;
  }

  updateUI(patch: Partial<UiSettings>): void {
    this.ui = { ...this.ui, ...patch };
  }

  setProjectRoots(roots: string[]): void {
    if (!roots || roots.length === 0) {
      throw new Error("At least one project root is required");
    }
    this.projectRoots = roots;
  }

  addProjectRoot(root: string): void {
    const trimmed = root.trim();
    if (!trimmed) {
      return;
    }
    if (!this.projectRoots.includes(trimmed)) {
      this.projectRoots.push(trimmed);
    }
  }

  removeProjectRoot(root: string): void {
    if (this.projectRoots.length <= 1) {
      throw new Error("Must keep at least one project root");
    }
    this.projectRoots = this.projectRoots.filter((r) => r !== root);
  }

  toDTO(): Settings {
    return {
      ui: this.ui,
      projectRoots: this.projectRoots,
    };
  }
}
