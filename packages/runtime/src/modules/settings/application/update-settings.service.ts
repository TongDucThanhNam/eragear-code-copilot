import { ValidationError } from "#runtime/shared/errors";
import type {
  AppConfig,
  Settings,
  UiSettings,
} from "#runtime/shared/types/settings.types";
import { APP_CONFIG_KEYS, type AppConfigService } from "../app-config.service";
import { SettingsAggregate } from "../domain/settings.entity";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";
import type { SettingsChangeNotifier } from "./settings-change.notifier";

/**
 * Result of one persisted settings update.
 *
 * Caller contract: `requiresRestart` lists changed settings that cannot be
 * applied to the current runtime safely.
 */
export interface UpdateSettingsResult {
  settings: Settings;
  requiresRestart: string[];
  changedKeys: string[];
}

export interface SettingsPatch {
  ui?: Partial<UiSettings>;
  projectRoots?: string[];
  mcpServers?: Settings["mcpServers"];
  app?: Partial<AppConfig>;
}

/**
 * Applies a validated settings patch and reports the settings change.
 *
 * Side effects: app config is reloaded live after persistence, then
 * the settings change notifier fans out update notifications.
 */
export class UpdateSettingsService {
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly settingsChangeNotifier: SettingsChangeNotifier;
  private readonly appConfigService: AppConfigService;

  constructor(
    settingsRepo: SettingsRepositoryPort,
    settingsChangeNotifier: SettingsChangeNotifier,
    appConfigService: AppConfigService
  ) {
    this.settingsRepo = settingsRepo;
    this.settingsChangeNotifier = settingsChangeNotifier;
    this.appConfigService = appConfigService;
  }

  async execute(patch: SettingsPatch): Promise<UpdateSettingsResult> {
    const current = await this.settingsRepo.get();
    const aggregate = new SettingsAggregate(current);
    const normalizedPatch: Partial<Settings> = {};

    if (patch.ui !== undefined) {
      aggregate.updateUI(patch.ui);
      normalizedPatch.ui = aggregate.ui;
    }
    if (patch.projectRoots !== undefined) {
      try {
        aggregate.setProjectRoots(patch.projectRoots);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid project roots";
        throw new ValidationError(message, {
          module: "settings",
          op: "settings.update",
        });
      }
      normalizedPatch.projectRoots = aggregate.projectRoots;
    }
    if (patch.mcpServers !== undefined) {
      aggregate.setMcpServers(patch.mcpServers);
      normalizedPatch.mcpServers = aggregate.mcpServers;
    }
    if (patch.app !== undefined) {
      try {
        normalizedPatch.app = this.appConfigService.validatePatch(patch.app);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid app configuration";
        throw new ValidationError(message, {
          module: "settings",
          op: "settings.update",
        });
      }
    }

    const settings = await this.settingsRepo.save(
      mergeSettingsPatch(current, normalizedPatch)
    );
    this.appConfigService.reloadFromSettings(settings);
    const changedKeys: string[] = [];
    const requiresRestart: string[] = [];

    if (
      JSON.stringify(current.projectRoots) !==
      JSON.stringify(settings.projectRoots)
    ) {
      changedKeys.push("projectRoots");
      requiresRestart.push("projectRoots");
    }

    if (JSON.stringify(current.ui) !== JSON.stringify(settings.ui)) {
      changedKeys.push("ui");
    }

    if (
      JSON.stringify(current.mcpServers ?? []) !==
      JSON.stringify(settings.mcpServers ?? [])
    ) {
      changedKeys.push("mcpServers");
      requiresRestart.push("mcpServers");
    }

    for (const key of APP_CONFIG_KEYS) {
      if (current.app[key] !== settings.app[key]) {
        changedKeys.push(`app.${key}`);
      }
    }

    await this.settingsChangeNotifier.publishSettingsChanged({
      changedKeys,
      requiresRestart,
    });

    return {
      settings,
      requiresRestart,
      changedKeys,
    };
  }
}

function mergeSettingsPatch(
  current: Settings,
  patch: Partial<Settings>
): Settings {
  return {
    ...current,
    ...patch,
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    mcpServers:
      patch.mcpServers !== undefined ? patch.mcpServers : current.mcpServers,
    projectRoots:
      patch.projectRoots !== undefined
        ? patch.projectRoots
        : current.projectRoots,
    app: { ...current.app, ...(patch.app ?? {}) },
  };
}
