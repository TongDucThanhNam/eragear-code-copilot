import type { SettingsServiceFactory } from "@/modules/service-factories";
import {
  GetSettingsService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "@/modules/settings";
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
  const manageBootAllowlistsService = new ManageBootAllowlistsService(
    deps.eventBus,
    deps.agentRuntimeAdapter
  );

  return {
    getSettings: () => getSettingsService,
    updateSettings: () => updateSettingsService,
    manageBootAllowlists: () => manageBootAllowlistsService,
  };
}
