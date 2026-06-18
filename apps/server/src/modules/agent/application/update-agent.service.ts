import { NotFoundError } from "@/shared/errors";
import type { AgentUpdateInput } from "@/shared/types/agent.types";
import type { AgentLifecycleNotifier } from "./agent-lifecycle.notifier";
import { normalizeAgentUpdateInput } from "./normalize-agent-input.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.update";

/**
 * Updates one user-owned agent configuration.
 *
 * Error mode: missing or cross-user IDs throw `NotFoundError`; accepted input is
 * normalized before persistence and followed by an agent-updated notification.
 */
export class UpdateAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly agentLifecycleNotifier: AgentLifecycleNotifier;

  constructor(
    agentRepo: AgentRepositoryPort,
    agentLifecycleNotifier: AgentLifecycleNotifier
  ) {
    this.agentRepo = agentRepo;
    this.agentLifecycleNotifier = agentLifecycleNotifier;
  }

  async execute(userId: string, input: Omit<AgentUpdateInput, "userId">) {
    const existing = await this.agentRepo.findById(input.id, userId);
    if (!existing) {
      throw new NotFoundError("Agent not found", {
        module: "agent",
        op: OP,
        details: { id: input.id },
      });
    }
    const normalized = normalizeAgentUpdateInput({ ...input, userId }, OP);
    const agent = await this.agentRepo.update(normalized);
    await this.agentLifecycleNotifier.agentUpdated({
      userId,
      agentId: agent.id,
    });
    return agent;
  }
}
