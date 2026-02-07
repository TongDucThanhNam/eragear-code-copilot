import { NotFoundError } from "@/shared/errors";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.set_active";

export class SetActiveAgentService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(id: string | null) {
    if (id) {
      const existing = await this.agentRepo.findById(id);
      if (!existing) {
        throw new NotFoundError("Agent not found", {
          module: "agent",
          op: OP,
          details: { id },
        });
      }
    }
    await this.agentRepo.setActive(id);
    return { activeAgentId: id };
  }
}
