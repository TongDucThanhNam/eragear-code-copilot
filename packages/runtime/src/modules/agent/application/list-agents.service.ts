import type { AgentRepositoryPort } from "./ports/agent-repository.port";

/**
 * Lists agents for a user and optional project scope.
 *
 * Side effect: repairs a dangling active-agent id by selecting the first
 * available agent or clearing active state when no agents remain.
 */
export class ListAgentsService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(userId: string, projectId?: string | null) {
    return await this.agentRepo.listByProjectWithActiveState(projectId, userId);
  }
}
