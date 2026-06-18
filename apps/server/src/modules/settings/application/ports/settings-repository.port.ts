import type { Settings } from "@/shared/types/settings.types";

/**
 * Settings persistence port for server-wide configuration.
 *
 * Caller contract: callers pass full settings snapshots to `save`; patch merge
 * and product validation live in the settings application module.
 */
export interface SettingsRepositoryPort {
  /** Get current settings */
  get(): Promise<Settings>;
  /** Persist a full settings snapshot */
  save(settings: Settings): Promise<Settings>;
}
