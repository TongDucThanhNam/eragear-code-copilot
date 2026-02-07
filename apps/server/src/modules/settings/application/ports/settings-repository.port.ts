import type { Settings } from "@/shared/types/settings.types";

/**
 * Port for settings persistence operations.
 */
export interface SettingsRepositoryPort {
  /** Get current settings */
  get(): Promise<Settings>;
  /** Update settings with a partial patch */
  update(patch: Partial<Settings>): Promise<Settings>;
}
