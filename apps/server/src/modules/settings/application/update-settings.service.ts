import type { ProjectRepositoryPort } from "@/modules/project";
import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { Settings } from "@/shared/types/settings.types";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

export interface UpdateSettingsResult {
  settings: Settings;
  requiresRestart: string[];
  changedKeys: string[];
}

export class UpdateSettingsService {
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(
    settingsRepo: SettingsRepositoryPort,
    projectRepo: ProjectRepositoryPort,
    eventBus: EventBusPort
  ) {
    this.settingsRepo = settingsRepo;
    this.projectRepo = projectRepo;
    this.eventBus = eventBus;
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

    const current = await this.settingsRepo.get();
    const settings = await this.settingsRepo.update(patch);
    const changedKeys: string[] = [];
    const requiresRestart: string[] = [];

    if (
      JSON.stringify(current.projectRoots) !==
      JSON.stringify(settings.projectRoots)
    ) {
      changedKeys.push("projectRoots");
      await this.projectRepo.setAllowedRoots(settings.projectRoots);
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
