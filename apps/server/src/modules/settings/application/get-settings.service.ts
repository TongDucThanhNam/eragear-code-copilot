import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

/**
 * Reads the persisted settings snapshot.
 *
 * Caller contract: this does not merge environment defaults; use
 * `AppConfigService` when runtime app config normalization is required.
 */
export class GetSettingsService {
  private readonly settingsRepo: SettingsRepositoryPort;

  constructor(settingsRepo: SettingsRepositoryPort) {
    this.settingsRepo = settingsRepo;
  }

  execute() {
    return this.settingsRepo.get();
  }
}
