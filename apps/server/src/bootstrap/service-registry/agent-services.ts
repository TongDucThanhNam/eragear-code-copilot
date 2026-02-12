import {
  CreateAgentService,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "@/modules/agent";
import type { AgentServiceFactory } from "@/modules/service-factories";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createAgentServices(
  deps: ServiceRegistryDependencies
): AgentServiceFactory {
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
    ensureAgentDefaults: () => ensureAgentDefaultsService,
    listAgents: () => listAgentsService,
    createAgent: () => createAgentService,
    updateAgent: () => updateAgentService,
    deleteAgent: () => deleteAgentService,
    setActiveAgent: () => setActiveAgentService,
  };
}
