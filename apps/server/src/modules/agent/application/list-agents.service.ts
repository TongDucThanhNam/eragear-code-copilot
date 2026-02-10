import type { AgentRepositoryPort } from "./ports/agent-repository.port";

export class ListAgentsService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(userId: string, projectId?: string | null) {
    const [agents, allAgents, currentActiveAgentId] = await Promise.all([
      this.agentRepo.listByProject(projectId, userId),
      this.agentRepo.findAll(userId),
      this.agentRepo.getActiveId(userId),
    ]);

    let activeAgentId = currentActiveAgentId;
    const hasValidActiveAgent =
      activeAgentId !== null &&
      allAgents.some((agent) => agent.id === activeAgentId);
    if (!hasValidActiveAgent && allAgents.length > 0) {
      activeAgentId = allAgents[0]?.id ?? null;
      await this.agentRepo.setActive(activeAgentId, userId);
    } else if (!hasValidActiveAgent) {
      activeAgentId = null;
    }

    return {
      agents,
      activeAgentId,
    };
  }
}
