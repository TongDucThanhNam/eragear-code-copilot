import { NotFoundError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { AgentUpdateInput } from "@/shared/types/agent.types";
import { normalizeAgentUpdateInput } from "./normalize-agent-input.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.update";

export class UpdateAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(agentRepo: AgentRepositoryPort, eventBus: EventBusPort) {
    this.agentRepo = agentRepo;
    this.eventBus = eventBus;
  }

  async execute(input: AgentUpdateInput) {
    const existing = await this.agentRepo.findById(input.id);
    if (!existing) {
      throw new NotFoundError("Agent not found", {
        module: "agent",
        op: OP,
        details: { id: input.id },
      });
    }
    const normalized = normalizeAgentUpdateInput(input, OP);
    const agent = await this.agentRepo.update(normalized);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "agent_updated",
      agentId: agent.id,
    });
    return agent;
  }
}
