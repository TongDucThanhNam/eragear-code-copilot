import {
  createEventBusSettingsChangeNotifier,
  GetSettingsService,
  LocalAdeService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "#runtime/modules/settings";
import type { SettingsUseCases } from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type SettingsServiceDependencies = ServiceRegistrySlice<
  | "eventBus"
  | "settingsRepo"
  | "appConfigService"
  | "uiSettingsService"
  | "agentRuntimeAdapter"
  | "projectRepo"
  | "agentRepo"
  | "sessionRepo"
  | "sessionRuntime"
  | "logStore"
  | "getBackgroundRunnerState"
>;

export function createSettingsUseCases(
  deps: SettingsServiceDependencies
): SettingsUseCases {
  const settingsChangeNotifier = createEventBusSettingsChangeNotifier(
    deps.eventBus
  );
  const getSettingsService = new GetSettingsService(deps.settingsRepo);
  const updateSettingsService = new UpdateSettingsService(
    deps.settingsRepo,
    settingsChangeNotifier,
    deps.appConfigService,
    deps.uiSettingsService
  );
  const manageBootAllowlistsService = new ManageBootAllowlistsService(
    settingsChangeNotifier,
    deps.agentRuntimeAdapter
  );
  const localAdeService = new LocalAdeService({
    projectRepo: deps.projectRepo,
    agentRepo: deps.agentRepo,
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    logStore: deps.logStore,
    settingsRepo: deps.settingsRepo,
    appConfigService: deps.appConfigService,
    getBackgroundRunnerState: deps.getBackgroundRunnerState,
    settingsChangeNotifier,
  });

  return {
    get: getSettingsService,
    update: updateSettingsService,
    manageBootAllowlists: manageBootAllowlistsService,
    localAde: localAdeService,
  };
}
