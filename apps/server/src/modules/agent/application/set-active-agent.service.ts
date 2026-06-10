import { NotFoundError } from "@/shared/errors";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.set_active";

/**
 * Sets or clears the active agent for a user.
 *
 * Error mode: non-null IDs must belong to the user or a `NotFoundError` is
 * thrown before active state is changed.
 */
export class SetActiveAgentService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(userId: string, id: string | null) {
    if (id) {
      const existing = await this.agentRepo.findById(id, userId);
      if (!existing) {
        throw new NotFoundError("Agent not found", {
          module: "agent",
          op: OP,
          details: { id },
        });
      }
    }
    await this.agentRepo.setActive(id, userId);
    return { activeAgentId: id };
  }
}
