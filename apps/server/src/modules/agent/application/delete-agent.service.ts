import { NotFoundError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.delete";

export class DeleteAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(agentRepo: AgentRepositoryPort, eventBus: EventBusPort) {
    this.agentRepo = agentRepo;
    this.eventBus = eventBus;
  }

  async execute(userId: string, id: string) {
    const existing = await this.agentRepo.findById(id, userId);
    if (!existing) {
      throw new NotFoundError("Agent not found", {
        module: "agent",
        op: OP,
        details: { id },
      });
    }
    const activeAgentId = await this.agentRepo.getActiveId(userId);
    await this.agentRepo.delete(id, userId);
    if (activeAgentId === id) {
      const remainingAgents = await this.agentRepo.findAll(userId);
      await this.agentRepo.setActive(remainingAgents[0]?.id ?? null, userId);
    }
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "agent_deleted",
      userId,
      agentId: id,
    });
    return { success: true };
  }
}
