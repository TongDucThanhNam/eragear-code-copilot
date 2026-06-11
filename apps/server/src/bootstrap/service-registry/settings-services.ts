import {
  GetSettingsService,
  LocalAdeService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "@/modules/settings";
import type { SettingsUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createSettingsUseCases(
  deps: ServiceRegistryDependencies
): SettingsUseCases {
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
  const localAdeService = new LocalAdeService({
    projectRepo: deps.projectRepo,
    agentRepo: deps.agentRepo,
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    logStore: deps.logStore,
  });
  localAdeService.subscribeLifecycleEvents(deps.eventBus);

  return {
    get: getSettingsService,
    update: updateSettingsService,
    manageBootAllowlists: manageBootAllowlistsService,
    localAde: localAdeService,
  };
}
