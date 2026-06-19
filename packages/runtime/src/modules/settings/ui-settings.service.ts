import {
  DEFAULT_UI_SETTINGS,
  UiSettingsSchema,
} from "#runtime/shared/contracts/settings.contract";
import type {
  Settings,
  UiSettings,
} from "#runtime/shared/types/settings.types";
import type { SettingsRepositoryPort } from "./application/ports/settings-repository.port";

type UiSettingsListener = (settings: UiSettings) => void;

function freezeUiSettings(settings: UiSettings): UiSettings {
  return Object.freeze({ ...settings });
}

function normalizeUiSettings(value: unknown): UiSettings {
  return UiSettingsSchema.parse(value);
}

/**
 * In-memory UI settings cache for hot paths that must not read persisted
 * settings on each ACP chunk.
 */
export class UiSettingsService {
  private current: UiSettings;
  private readonly listeners = new Set<UiSettingsListener>();

  constructor(initialSettings: UiSettings = DEFAULT_UI_SETTINGS) {
    this.current = freezeUiSettings(normalizeUiSettings(initialSettings));
  }

  static async create(
    settingsRepo: SettingsRepositoryPort
  ): Promise<UiSettingsService> {
    try {
      const settings = await settingsRepo.get();
      return new UiSettingsService(settings.ui);
    } catch {
      return new UiSettingsService(DEFAULT_UI_SETTINGS);
    }
  }

  getSettings(): UiSettings {
    return this.current;
  }

  isReasoningVisible(): boolean {
    return this.current.showReasoning;
  }

  subscribe(listener: UiSettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reloadFromSettings(settings: Pick<Settings, "ui">): UiSettings {
    return this.replace(normalizeUiSettings(settings.ui));
  }

  private replace(next: UiSettings): UiSettings {
    if (JSON.stringify(this.current) === JSON.stringify(next)) {
      return this.current;
    }
    const frozen = freezeUiSettings(next);
    this.current = frozen;
    for (const listener of this.listeners) {
      listener(frozen);
    }
    return frozen;
  }
}
