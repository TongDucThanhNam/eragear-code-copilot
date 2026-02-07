import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { AgentInput } from "@/shared/types/agent.types";
import { normalizeAgentInput } from "./normalize-agent-input.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.create";

export class CreateAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(agentRepo: AgentRepositoryPort, eventBus: EventBusPort) {
    this.agentRepo = agentRepo;
    this.eventBus = eventBus;
  }

  async execute(input: AgentInput) {
    const normalized = normalizeAgentInput(input, OP);
    const agent = await this.agentRepo.create(normalized);
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "agent_created",
      agentId: agent.id,
    });
    return agent;
  }
}
