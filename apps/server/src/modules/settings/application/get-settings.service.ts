import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

export class GetSettingsService {
  private readonly settingsRepo: SettingsRepositoryPort;

  constructor(settingsRepo: SettingsRepositoryPort) {
    this.settingsRepo = settingsRepo;
  }

  execute() {
    return this.settingsRepo.get();
  }
}
