import { buildDefaultAgentInput } from "./default-agent.constants";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const ensureDefaultsInFlight = new Map<string, Promise<void>>();

export class EnsureAgentDefaultsService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async execute(userId: string): Promise<void> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return;
    }

    const existing = ensureDefaultsInFlight.get(normalizedUserId);
    if (existing) {
      await existing;
      return;
    }

    const task = this.ensureDefaults(normalizedUserId).finally(() => {
      if (ensureDefaultsInFlight.get(normalizedUserId) === task) {
        ensureDefaultsInFlight.delete(normalizedUserId);
      }
    });

    ensureDefaultsInFlight.set(normalizedUserId, task);
    await task;
  }

  private async ensureDefaults(userId: string): Promise<void> {
    const agents = await this.agentRepo.findAll(userId);
    if (agents.length === 0) {
      const created = await this.agentRepo.create(
        buildDefaultAgentInput(userId)
      );
      await this.agentRepo.setActive(created.id, userId);
      return;
    }

    const activeAgentId = await this.agentRepo.getActiveId(userId);
    const hasValidActiveAgent =
      activeAgentId !== null &&
      agents.some((agent) => agent.id === activeAgentId);
    if (hasValidActiveAgent) {
      return;
    }

    const fallbackAgentId = agents[0]?.id ?? null;
    await this.agentRepo.setActive(fallbackAgentId, userId);
  }
}
