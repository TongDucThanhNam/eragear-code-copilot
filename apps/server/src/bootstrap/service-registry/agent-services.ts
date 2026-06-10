import {
  CreateAgentService,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "@/modules/agent";
import type { AgentUseCases } from "@/modules/use-cases";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createAgentUseCases(
  deps: ServiceRegistryDependencies
): AgentUseCases {
  const ensureAgentDefaultsService = new EnsureAgentDefaultsService(
    deps.agentRepo
  );
  const listAgentsService = new ListAgentsService(deps.agentRepo);
  const createAgentService = new CreateAgentService(
    deps.agentRepo,
    deps.eventBus
  );
  const updateAgentService = new UpdateAgentService(
    deps.agentRepo,
    deps.eventBus
  );
  const deleteAgentService = new DeleteAgentService(
    deps.agentRepo,
    deps.eventBus
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
