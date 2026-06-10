import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { AgentInput } from "@/shared/types/agent.types";
import { normalizeAgentInput } from "./normalize-agent-input.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.create";

/**
 * Creates one user-owned agent configuration.
 *
 * Side effects: normalizes command/config input, initializes the active agent
 * when the user has none, and publishes a dashboard refresh event.
 */
export class CreateAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly eventBus: EventBusPort;

  constructor(agentRepo: AgentRepositoryPort, eventBus: EventBusPort) {
    this.agentRepo = agentRepo;
    this.eventBus = eventBus;
  }

  async execute(userId: string, input: Omit<AgentInput, "userId">) {
    const normalized = normalizeAgentInput({ ...input, userId }, OP);
    const agent = await this.agentRepo.create(normalized);
    const activeAgentId = await this.agentRepo.getActiveId(userId);
    if (!activeAgentId) {
      await this.agentRepo.setActive(agent.id, userId);
    }
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "agent_created",
      userId,
      agentId: agent.id,
    });
    return agent;
  }
}
