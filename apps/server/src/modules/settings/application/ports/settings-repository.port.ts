import type { Settings } from "@/shared/types/settings.types";

/**
 * Settings persistence port for server-wide configuration.
 *
 * Caller contract: `update` receives a partial patch and returns the normalized
 * full settings snapshot after domain validation/persistence.
 */
export interface SettingsRepositoryPort {
  /** Get current settings */
  get(): Promise<Settings>;
  /** Update settings with a partial patch */
  update(patch: Partial<Settings>): Promise<Settings>;
}
