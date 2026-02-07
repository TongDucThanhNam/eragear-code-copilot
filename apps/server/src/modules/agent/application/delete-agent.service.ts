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

  async execute(id: string) {
    const existing = await this.agentRepo.findById(id);
    if (!existing) {
      throw new NotFoundError("Agent not found", {
        module: "agent",
        op: OP,
        details: { id },
      });
    }
    await this.agentRepo.delete(id);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "agent_deleted",
      agentId: id,
    });
    return { success: true };
  }
}
