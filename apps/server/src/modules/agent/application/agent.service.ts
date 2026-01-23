import type {
  AgentInput,
  AgentUpdateInput,
} from "../../../shared/types/agent.types";
import type { AgentRepositoryPort } from "../../../shared/types/ports";

export class AgentService {
  constructor(private agentRepo: AgentRepositoryPort) {}

  listAgents(projectId?: string | null) {
    return this.agentRepo.listByProject(projectId);
  }

  createAgent(input: AgentInput) {
    return this.agentRepo.create(input);
  }

  updateAgent(input: AgentUpdateInput) {
    return this.agentRepo.update(input);
  }

  deleteAgent(id: string) {
    this.agentRepo.delete(id);
    return { success: true };
  }

  setActive(id: string | null) {
    return this.agentRepo.setActive(id);
  }
}
