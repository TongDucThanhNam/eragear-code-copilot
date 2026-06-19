import {
  CreateAgentService,
  createEventBusAgentLifecycleNotifier,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "#runtime/modules/agent";
import type { AgentUseCases } from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type AgentServiceDependencies = ServiceRegistrySlice<"eventBus" | "agentRepo">;

export function createAgentUseCases(
  deps: AgentServiceDependencies
): AgentUseCases {
  const agentLifecycleNotifier = createEventBusAgentLifecycleNotifier(
    deps.eventBus
  );
  const ensureAgentDefaultsService = new EnsureAgentDefaultsService(
    deps.agentRepo
  );
  const listAgentsService = new ListAgentsService(deps.agentRepo);
  const createAgentService = new CreateAgentService(
    deps.agentRepo,
    agentLifecycleNotifier
  );
  const updateAgentService = new UpdateAgentService(
    deps.agentRepo,
    agentLifecycleNotifier
  );
  const deleteAgentService = new DeleteAgentService(
    deps.agentRepo,
    agentLifecycleNotifier
  );
  const setActiveAgentService = new SetActiveAgentService(deps.agentRepo);

  return {
    ensureDefaults: ensureAgentDefaultsService,
    list: listAgentsService,
    create: createAgentService,
    update: updateAgentService,
    delete: deleteAgentService,
    setActive: setActiveAgentService,
  };
}
