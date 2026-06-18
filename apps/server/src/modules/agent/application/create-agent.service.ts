import type { AgentInput } from "@/shared/types/agent.types";
import type { AgentLifecycleNotifier } from "./agent-lifecycle.notifier";
import { normalizeAgentInput } from "./normalize-agent-input.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.create";

/**
 * Creates one user-owned agent configuration.
 *
 * Side effects: normalizes command/config input, initializes the active agent
 * when the user has none, and reports an agent-created notification.
 */
export class CreateAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly agentLifecycleNotifier: AgentLifecycleNotifier;

  constructor(
    agentRepo: AgentRepositoryPort,
    agentLifecycleNotifier: AgentLifecycleNotifier
  ) {
    this.agentRepo = agentRepo;
    this.agentLifecycleNotifier = agentLifecycleNotifier;
  }

  async execute(userId: string, input: Omit<AgentInput, "userId">) {
    const normalized = normalizeAgentInput({ ...input, userId }, OP);
    const agent = await this.agentRepo.createAndEnsureActive(normalized);
    await this.agentLifecycleNotifier.agentCreated({
      userId,
      agentId: agent.id,
    });
    return agent;
  }
}
