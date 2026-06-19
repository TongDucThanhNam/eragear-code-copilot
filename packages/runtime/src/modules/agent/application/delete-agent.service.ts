import { NotFoundError } from "#runtime/shared/errors";
import type { AgentLifecycleNotifier } from "./agent-lifecycle.notifier";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const OP = "agent.config.delete";

/**
 * Deletes one user-owned agent configuration.
 *
 * Invariant: delete repairs active state to the first remaining agent or
 * `null`, preventing missing/dangling active-agent references.
 */
export class DeleteAgentService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly agentLifecycleNotifier: AgentLifecycleNotifier;

  constructor(
    agentRepo: AgentRepositoryPort,
    agentLifecycleNotifier: AgentLifecycleNotifier
  ) {
    this.agentRepo = agentRepo;
    this.agentLifecycleNotifier = agentLifecycleNotifier;
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
    await this.agentRepo.deleteAndRepairActive(id, userId);
    await this.agentLifecycleNotifier.agentDeleted({
      userId,
      agentId: id,
    });
    return { success: true };
  }
}
