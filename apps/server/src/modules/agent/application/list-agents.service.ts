import type { AgentRepositoryPort } from "./ports/agent-repository.port";

export class ListAgentsService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(userId: string, projectId?: string | null) {
    return {
      agents: await this.agentRepo.listByProject(projectId, userId),
      activeAgentId: await this.agentRepo.getActiveId(userId),
    };
  }
}
