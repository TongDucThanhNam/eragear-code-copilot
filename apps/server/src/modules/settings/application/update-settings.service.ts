import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Settings } from "@/shared/types/settings.types";
import { APP_CONFIG_KEYS, type AppConfigService } from "../app-config.service";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

export interface UpdateSettingsResult {
  settings: Settings;
  requiresRestart: string[];
  changedKeys: string[];
}

export class UpdateSettingsService {
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly eventBus: EventBusPort;
  private readonly appConfigService: AppConfigService;

  constructor(
    settingsRepo: SettingsRepositoryPort,
    eventBus: EventBusPort,
    appConfigService: AppConfigService
  ) {
    this.settingsRepo = settingsRepo;
    this.eventBus = eventBus;
    this.appConfigService = appConfigService;
  }

  async execute(patch: Partial<Settings>): Promise<UpdateSettingsResult> {
    if (
      patch.projectRoots !== undefined &&
      (!Array.isArray(patch.projectRoots) || patch.projectRoots.length < 1)
    ) {
      throw new ValidationError("At least one project root is required.", {
        module: "settings",
        op: "settings.update",
      });
    }

    const normalizedPatch: Partial<Settings> = {
      ...patch,
    };
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

    const current = await this.settingsRepo.get();
    const settings = await this.settingsRepo.update(normalizedPatch);
    this.appConfigService.reloadFromSettings(settings);
    const changedKeys: string[] = [];
    const requiresRestart: string[] = [];

    if (
      JSON.stringify(current.projectRoots) !==
      JSON.stringify(settings.projectRoots)
    ) {
      changedKeys.push("projectRoots");
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

    await this.eventBus.publish({
      type: "settings_updated",
      changedKeys,
      requiresRestart,
    });
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "settings_updated",
    });

    return {
      settings,
      requiresRestart,
      changedKeys,
    };
  }
}
