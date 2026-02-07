import type { AgentRepositoryPort } from "./ports/agent-repository.port";

export class ListAgentsService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(projectId?: string | null) {
    return {
      agents: await this.agentRepo.listByProject(projectId),
      activeAgentId: await this.agentRepo.getActiveId(),
    };
  }
}
