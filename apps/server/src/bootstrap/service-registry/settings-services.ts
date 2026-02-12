import type { SettingsServiceFactory } from "@/modules/service-factories";
import { GetSettingsService, UpdateSettingsService } from "@/modules/settings";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createSettingsServices(
  deps: ServiceRegistryDependencies
): SettingsServiceFactory {
  const getSettingsService = new GetSettingsService(deps.settingsRepo);
  const updateSettingsService = new UpdateSettingsService(
    deps.settingsRepo,
    deps.eventBus,
    deps.appConfigService
  );

  return {
    getSettings: () => getSettingsService,
    updateSettings: () => updateSettingsService,
  };
}
