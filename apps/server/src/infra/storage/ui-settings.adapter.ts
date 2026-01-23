// Settings storage adapter
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from './json-store';
import type { SettingsRepositoryPort } from '../../shared/types/ports';
import type { Settings } from '../../shared/types/settings.types';

const UiSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  accentColor: z.string().min(4),
  density: z.enum(['comfortable', 'compact']),
  fontScale: z.number().min(0.8).max(1.3),
});

const SettingsSchema = z.object({
  ui: UiSettingsSchema,
  projectRoots: z.array(z.string()).min(1).default([process.cwd()]),
});

const SETTINGS_FILE = 'ui-settings.json';

const DEFAULT_SETTINGS: Settings = {
  ui: {
    theme: 'system',
    accentColor: '#2563eb',
    density: 'comfortable',
    fontScale: 1,
  },
  projectRoots: [process.cwd()],
};

export class SettingsStorageAdapter implements SettingsRepositoryPort {
  get(): Settings {
    const raw = readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
    try {
      return SettingsSchema.parse(raw);
    } catch {
      try {
        const parsed = raw as Partial<Settings>;
        const uiResult = UiSettingsSchema.safeParse(parsed.ui);
        const projectRoots = Array.isArray(parsed.projectRoots)
          ? parsed.projectRoots
          : DEFAULT_SETTINGS.projectRoots;
        const next: Settings = {
          ui: uiResult.success ? uiResult.data : DEFAULT_SETTINGS.ui,
          projectRoots: projectRoots.length > 0 ? projectRoots : DEFAULT_SETTINGS.projectRoots,
        };
        writeJsonFile(SETTINGS_FILE, next);
        return next;
      } catch {
        writeJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }
    }
  }

  update(patch: Partial<Settings>): Settings {
    const current = this.get();
    const next: Settings = {
      ...current,
      ...patch,
      ui: { ...current.ui, ...(patch.ui ?? {}) },
    };
    writeJsonFile(SETTINGS_FILE, next);
    return next;
  }
}
